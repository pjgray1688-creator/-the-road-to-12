import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { connect as connectTls, type TLSSocket } from "node:tls";
import type { NotificationEnvelope } from "./notification-provider";
import { inspectSmtpConfiguration, type SmtpConfiguration } from "./smtp-config";
import { NOTIFICATION_WORKER_MESSAGE_TIMEOUT_MS } from "./notification-worker";

type Socket = ReturnType<typeof createConnection> | TLSSocket;
export type SmtpConnector = (configuration: SmtpConfiguration) => Promise<Socket>;
type SmtpError = Error & { smtpCode?: number };

function smtpError(message: string, code?: number): SmtpError {
  const error = new Error(message) as SmtpError;
  error.smtpCode = code;
  return error;
}

class ReplyReader {
  private buffer = "";
  private lines: string[] = [];
  private waiters: Array<(line: string) => void> = [];
  private failure?: Error;
  private readonly onData = (chunk: Buffer) => {
    this.buffer += chunk.toString("utf8");
    const pieces = this.buffer.split("\r\n");
    this.buffer = pieces.pop() ?? "";
    for (const line of pieces) {
      const waiter = this.waiters.shift();
      if (waiter) waiter(line); else this.lines.push(line);
    }
  };
  private readonly onError = (error: Error) => { this.failure = error; this.flushFailure(); };
  private readonly onClose = () => { this.failure ??= new Error("SMTP connection closed unexpectedly"); this.flushFailure(); };

  constructor(private readonly socket: Socket) {
    socket.on("data", this.onData);
    socket.on("error", this.onError);
    socket.on("close", this.onClose);
  }

  private flushFailure() {
    while (this.waiters.length) this.waiters.shift()!(this.failure?.message ?? "SMTP connection failed");
  }

  private readLine() {
    if (this.lines.length) return Promise.resolve(this.lines.shift()!);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise<string>(resolve => this.waiters.push(resolve));
  }

  async readReply() {
    const lines: string[] = [];
    for (let index = 0; index < 20; index++) {
      const line = await this.readLine();
      lines.push(line);
      const match = line.match(/^(\d{3})([ -])/);
      if (!match) throw smtpError("SMTP server returned an invalid response");
      if (match[2] === " ") return { code: Number(match[1]), text: lines.join("\n") };
    }
    throw smtpError("SMTP server returned an oversized response");
  }

  dispose() {
    this.socket.off("data", this.onData);
    this.socket.off("error", this.onError);
    this.socket.off("close", this.onClose);
  }
}

function assertCode(reply: { code: number; text: string }, accepted: number[]) {
  if (!accepted.includes(reply.code)) throw smtpError(`SMTP server rejected a delivery step (${reply.code})`, reply.code);
}

function write(socket: Socket, value: string) {
  return new Promise<void>((resolve, reject) => socket.write(value, error => error ? reject(error) : resolve()));
}

function safeHeader(value: string) { return value.replace(/[\r\n]/g, " ").trim(); }
function encodeHeader(value: string) { return `=?UTF-8?B?${Buffer.from(safeHeader(value), "utf8").toString("base64")}?=`; }
function encodeBody(value: string) { return Buffer.from(value.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? ""; }
function formatAddress(name: string, address: string) { return `${encodeHeader(name)} <${address}>`; }

function buildMessage(config: SmtpConfiguration, envelope: NotificationEnvelope) {
  const recipient = envelope.recipientEmail.trim().toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)) throw smtpError("Recipient email address is invalid");
  const from = config.from[envelope.sender];
  const boundary = `r12-${randomUUID()}`;
  let host = "the-road-to-12.vercel.app";
  try { if (process.env.R12_APP_BASE_URL) host = new URL(process.env.R12_APP_BASE_URL).hostname; } catch { /* use stable fallback; never let a malformed display URL block delivery */ }
  return [
    `From: ${formatAddress(from.name, from.address)}`,
    `To: <${recipient}>`,
    `Subject: ${encodeHeader(envelope.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@${host}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeBody(envelope.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    encodeBody(envelope.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function connectedSocket(config: SmtpConfiguration): Promise<Socket> {
  if (config.secure) {
    return new Promise((resolve, reject) => {
      const socket = connectTls({ host: config.host, port: config.port, servername: config.host });
      socket.setTimeout(NOTIFICATION_WORKER_MESSAGE_TIMEOUT_MS, () => socket.destroy(new Error("SMTP connection timed out")));
      socket.once("secureConnect", () => resolve(socket));
      socket.once("error", reject);
    });
  }
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: config.host, port: config.port });
    socket.setTimeout(NOTIFICATION_WORKER_MESSAGE_TIMEOUT_MS, () => socket.destroy(new Error("SMTP connection timed out")));
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

async function command(socket: Socket, reader: ReplyReader, value: string, accepted: number[]) {
  await write(socket, `${value}\r\n`);
  const reply = await reader.readReply();
  assertCode(reply, accepted);
  return reply;
}

export async function sendSmtpMessage(envelope: NotificationEnvelope, configuration?: SmtpConfiguration, connector: SmtpConnector = connectedSocket) {
  const config = configuration ?? inspectSmtpConfiguration().configuration;
  if (!config) throw smtpError("SMTP configuration is incomplete");
  const recipient = envelope.recipientEmail.trim().toLowerCase();
  let socket: Socket | undefined;
  let reader: ReplyReader | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    socket = await connector(config);
    deadline = setTimeout(() => socket?.destroy(new Error("SMTP message deadline exceeded")), NOTIFICATION_WORKER_MESSAGE_TIMEOUT_MS);
    reader = new ReplyReader(socket);
    assertCode(await reader.readReply(), [220]);
    let hello = await command(socket, reader, `EHLO ${safeHeader(config.host)}`, [250]);
    if (!config.secure) {
      await command(socket, reader, "STARTTLS", [220]);
      reader.dispose();
      socket.pause();
      const upgraded = await new Promise<TLSSocket>((resolve, reject) => {
        const secure = connectTls({ socket: socket as Socket, host: config.host, servername: config.host });
        secure.setTimeout(NOTIFICATION_WORKER_MESSAGE_TIMEOUT_MS, () => secure.destroy(new Error("SMTP TLS handshake timed out")));
        secure.once("secureConnect", () => resolve(secure));
        secure.once("error", reject);
      });
      socket = upgraded;
      socket.resume();
      reader = new ReplyReader(socket);
      hello = await command(socket, reader, `EHLO ${safeHeader(config.host)}`, [250]);
    }
    const authCapabilities = hello.text.toUpperCase();
    if (authCapabilities.includes("PLAIN")) {
      const plain = Buffer.from(`\0${config.username}\0${config.password}`, "utf8").toString("base64");
      const response = await command(socket, reader, `AUTH PLAIN ${plain}`, [235, 334]);
      if (response.code === 334) await command(socket, reader, plain, [235]);
    } else if (authCapabilities.includes("LOGIN")) {
      await command(socket, reader, "AUTH LOGIN", [334]);
      await command(socket, reader, Buffer.from(config.username, "utf8").toString("base64"), [334]);
      await command(socket, reader, Buffer.from(config.password, "utf8").toString("base64"), [235]);
    } else {
      throw smtpError("SMTP server does not advertise a supported AUTH mechanism");
    }
    await command(socket, reader, `MAIL FROM:<${config.from[envelope.sender].address}>`, [250]);
    await command(socket, reader, `RCPT TO:<${recipient}>`, [250, 251]);
    await command(socket, reader, "DATA", [354]);
    const message = buildMessage(config, envelope).replace(/\n\./g, "\n..");
    await write(socket, `${message.replace(/\r\n$/, "")}\r\n.\r\n`);
    const sent = await reader.readReply();
    assertCode(sent, [250]);
    try { await command(socket, reader, "QUIT", [221]); } catch { /* accepted mail remains sent if QUIT fails */ }
    return { provider: "smtp", reference: sent.text.match(/\b([A-Za-z0-9_-]{6,})\b/)?.[1] ?? `smtp-${randomUUID()}` };
  } catch (error) {
    const source = error as SmtpError;
    const code = source.smtpCode;
    const retryable = typeof code === "number" ? code >= 400 && code < 500 : true;
    throw Object.assign(new Error("SMTP delivery failed"), {
      deliveryCode: typeof code === "number" ? `smtp_${code}` : "smtp_transport_error",
      retryable,
    });
  } finally {
    if (deadline) clearTimeout(deadline);
    reader?.dispose();
    socket?.destroy();
  }
}
