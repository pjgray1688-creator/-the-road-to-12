import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { deliverNotification } from "../lib/notification-provider";
import { inspectSmtpConfiguration } from "../lib/smtp-config";
import { sendMadhouseApparelVerificationEmail, sendSmtpMessage, type SmtpConnector } from "../lib/smtp-transport";

class FakeSmtpSocket extends EventEmitter {
  readonly writes: string[] = [];
  constructor(private readonly username: string, private readonly password: string) { super(); }
  destroy() { this.emit("close"); }
  pause() { return this; }
  resume() { return this; }
  setTimeout() { return this; }
  write(chunk: string, callback?: (error?: Error | null) => void) {
    callback?.();
    const value = chunk.toString(); this.writes.push(value);
    let response = "";
    if (value.startsWith("EHLO")) response = "250-spacemail.test\r\n250 AUTH LOGIN\r\n";
    else if (value === "AUTH LOGIN\r\n") response = "334 VXNlcm5hbWU6\r\n";
    else if (value === `${Buffer.from(this.username).toString("base64")}\r\n`) response = "334 UGFzc3dvcmQ6\r\n";
    else if (value === `${Buffer.from(this.password).toString("base64")}\r\n`) response = "235 authenticated\r\n";
    else if (value.startsWith("MAIL FROM:") || value.startsWith("RCPT TO:")) response = "250 accepted\r\n";
    else if (value === "DATA\r\n") response = "354 send content\r\n";
    else if (value.endsWith("\r\n.\r\n")) response = "250 queued-id-789\r\n";
    else if (value === "QUIT\r\n") response = "221 bye\r\n";
    if (response) setImmediate(() => this.emit("data", Buffer.from(response)));
    return true;
  }
}

function fakeConnector(socket: FakeSmtpSocket): SmtpConnector {
  return async () => { setImmediate(() => socket.emit("data", Buffer.from("220 SpaceMail ready\r\n"))); return socket as never; };
}

const envKeys = [
  "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USERNAME", "SMTP_PASSWORD",
  "R12_EMAIL_FROM_MEMBERS", "R12_EMAIL_FROM_STAFF", "R12_EMAIL_FROM_BILLING",
  "MADHOUSE_APPAREL_SMTP_HOST", "MADHOUSE_APPAREL_SMTP_PORT", "MADHOUSE_APPAREL_SMTP_SECURE",
  "MADHOUSE_APPAREL_SMTP_USERNAME", "MADHOUSE_APPAREL_SMTP_PASSWORD",
  "MADHOUSE_APPAREL_EMAIL_FROM", "MADHOUSE_APPAREL_EMAIL_FROM_NAME", "MADHOUSE_APPAREL_EMAIL_SENDER_VERIFIED",
] as const;
function withSmtpEnvironment(run: () => Promise<void> | void) {
  const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    SMTP_HOST: "r12-mail.example.test", SMTP_PORT: "465", SMTP_SECURE: "true", SMTP_USERNAME: "r12-user", SMTP_PASSWORD: "r12-password",
    R12_EMAIL_FROM_MEMBERS: "members@r12.live", R12_EMAIL_FROM_STAFF: "staff@r12.live", R12_EMAIL_FROM_BILLING: "accounts@r12.live",
    MADHOUSE_APPAREL_SMTP_HOST: "mail.spacemail.com", MADHOUSE_APPAREL_SMTP_PORT: "465", MADHOUSE_APPAREL_SMTP_SECURE: "true",
    MADHOUSE_APPAREL_SMTP_USERNAME: "apparel-user", MADHOUSE_APPAREL_SMTP_PASSWORD: "apparel-password",
    MADHOUSE_APPAREL_EMAIL_FROM: "contact@madhousegym.online", MADHOUSE_APPAREL_EMAIL_FROM_NAME: "Madhouse Apparel",
  });
  delete process.env.MADHOUSE_APPAREL_EMAIL_SENDER_VERIFIED;
  return Promise.resolve().then(run).finally(() => {
    for (const key of envKeys) { const value = previous[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
}

test("R12 and Apparel SMTP profiles resolve separate credentials and TLS modes", () => withSmtpEnvironment(() => {
  const r12 = inspectSmtpConfiguration();
  const apparel = inspectSmtpConfiguration(process.env, "apparel");
  assert.equal(r12.configuration?.host, "r12-mail.example.test");
  assert.equal(r12.configuration?.username, "r12-user");
  assert.equal(r12.configuration?.requireTLS, false);
  assert.equal(apparel.configuration?.host, "mail.spacemail.com");
  assert.equal(apparel.configuration?.port, 465);
  assert.equal(apparel.configuration?.secure, true);
  assert.equal(apparel.configuration?.username, "apparel-user");
  assert.doesNotMatch(JSON.stringify(apparel.checks), /apparel-user|apparel-password/);
}));

test("Madhouse delivery test uses fixed recipient and branded sender without opening live order-email gate", () => withSmtpEnvironment(async () => {
  const socket = new FakeSmtpSocket("apparel-user", "apparel-password");
  const result = await sendMadhouseApparelVerificationEmail(fakeConnector(socket));
  const transcript = socket.writes.join("");
  assert.match(result.reference, /queued-id-789/);
  assert.match(transcript, /MAIL FROM:<contact@madhousegym\.online>/);
  assert.match(transcript, /RCPT TO:<contact@madhousegym\.online>/);
  const subject = transcript.match(/^Subject: =\?UTF-8\?B\?([^?]+)\?=\r$/m)?.[1];
  const textBase64 = transcript.match(/Content-Type: text\/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--madhouse-/)?.[1]?.replaceAll("\r\n", "");
  assert.equal(Buffer.from(subject ?? "", "base64").toString(), "[TEST] Madhouse Apparel email delivery verification");
  assert.match(Buffer.from(textBase64 ?? "", "base64").toString(), /No customer order was created, no payment was taken/);
  assert.doesNotMatch(transcript, /R12/i);
  assert.equal(process.env.MADHOUSE_APPAREL_EMAIL_SENDER_VERIFIED, undefined);
  const previousProvider = process.env.R12_EMAIL_PROVIDER;
  process.env.R12_EMAIL_PROVIDER = "smtp";
  try {
    const blocked = await deliverNotification({ id: "gated-apparel", recipientEmail: "customer@example.test", sender: "apparel", subject: "Order update", text: "Update", html: "<p>Update</p>" });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "madhouse_sender_not_verified");
  } finally {
    if (previousProvider === undefined) delete process.env.R12_EMAIL_PROVIDER; else process.env.R12_EMAIL_PROVIDER = previousProvider;
  }
}));

test("normal R12 mail still authenticates with the original SMTP settings", () => withSmtpEnvironment(async () => {
  const socket = new FakeSmtpSocket("r12-user", "r12-password");
  await sendSmtpMessage({ id: "r12-test", recipientEmail: "member@example.test", sender: "members", subject: "R12 test", text: "Hello", html: "<p>Hello</p>" }, undefined, fakeConnector(socket));
  const transcript = socket.writes.join("");
  assert.match(transcript, /MAIL FROM:<members@r12\.live>/);
  assert.match(transcript, new RegExp(Buffer.from("r12-user").toString("base64")));
  assert.doesNotMatch(transcript, new RegExp(Buffer.from("apparel-user").toString("base64")));
}));

test("Apparel outbox delivery cannot be marked sent through the mock transport", () => withSmtpEnvironment(async () => {
  const previousProvider = process.env.R12_EMAIL_PROVIDER;
  const previousGate = process.env.MADHOUSE_APPAREL_EMAIL_SENDER_VERIFIED;
  process.env.R12_EMAIL_PROVIDER = "mock";
  process.env.MADHOUSE_APPAREL_EMAIL_SENDER_VERIFIED = "true";
  try {
    const result = await deliverNotification({ id: "apparel-outbox-test", recipientEmail: "customer@example.test", sender: "apparel", subject: "Order update", text: "Test", html: "<p>Test</p>" });
    assert.deepEqual(result, { ok: false, state: "unavailable", code: "madhouse_smtp_required", message: "Madhouse Apparel requires its authenticated SMTP transport.", retryable: false });
  } finally {
    if (previousProvider === undefined) delete process.env.R12_EMAIL_PROVIDER; else process.env.R12_EMAIL_PROVIDER = previousProvider;
    if (previousGate === undefined) delete process.env.MADHOUSE_APPAREL_EMAIL_SENDER_VERIFIED; else process.env.MADHOUSE_APPAREL_EMAIL_SENDER_VERIFIED = previousGate;
  }
}));
