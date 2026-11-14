import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIPv4, type AddressInfo } from "node:net";
import { akuvoxA02Response } from "../../lib/akuvox-a02-response";

const UPSTREAM = "https://app.r12.live/api/club/access/decision";
const DENY = JSON.stringify({ isvalid: false });
const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store, no-cache, max-age=0",
  pragma: "no-cache",
};
const PIN_PATTERN = /^\d{8}$/;

type Config = {
  akuvoxHardwareDeviceId: string;
  r12DeviceId: string;
  r12DeviceSecret: string;
  basicUsername: string;
  basicPassword: string;
  allowedIps: ReadonlySet<string>;
  fetcher?: typeof fetch;
  now?: () => number;
  rateLimit?: number;
  tlsCertificate?: Buffer;
  tlsPrivateKey?: Buffer;
};

type DecisionPayload = {
  allowed?: unknown;
  decision?: unknown;
  unlockPermitted?: unknown;
};

function secureEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function normalizedIp(value: string): string {
  return value.startsWith("::ffff:") ? value.slice(7) : value;
}

function decodeBasic(header: string | null): { username: string; password: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const split = decoded.indexOf(":");
    if (split < 1) return null;
    return { username: decoded.slice(0, split), password: decoded.slice(split + 1) };
  } catch {
    return null;
  }
}

export function createAkuvoxA02Handler(config: Config) {
  const fetcher = config.fetcher ?? fetch;
  const now = config.now ?? Date.now;
  const limit = config.rateLimit ?? 30;
  const buckets = new Map<string, { start: number; count: number }>();
  // Keep only a one-way fingerprint. This short replay window complements the
  // authoritative per-request R12 nonce (the keypad protocol itself has no
  // documented request signature/nonce field).
  const recentPins = new Map<string, number>();

  return async (input: {
    method: string;
    url: URL;
    authorization: string | null;
    remoteAddress: string;
  }): Promise<{ status: number; body: string }> => {
    const source = normalizedIp(input.remoteAddress);
    if (!config.allowedIps.has(source)) return { status: 200, body: DENY };
    const instant = now();
    let bucket = buckets.get(source);
    if (!bucket || instant - bucket.start >= 60_000) {
      bucket = { start: instant, count: 0 };
      buckets.set(source, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) return { status: 200, body: DENY };

    const deviceId = input.url.searchParams.get("deviceId");
    const pin = input.url.searchParams.get("pin");
    const deviceTime = input.url.searchParams.get("time");
    const credentials = decodeBasic(input.authorization);
    // Akuvox's {DeviceID} is a hardware identifier, not the R12 database UUID.
    // It is pinned in gateway configuration and maps to the separately
    // provisioned R12 device ID used for server-side authentication.
    const permittedDevice = deviceId !== null && deviceId.length > 0
      && secureEqual(deviceId, config.akuvoxHardwareDeviceId);
    const permittedAuth = credentials !== null
      && secureEqual(credentials.username, config.basicUsername)
      && secureEqual(credentials.password, config.basicPassword);

    if (input.method !== "GET" || input.url.href.length > 1_024 || !permittedDevice || !permittedAuth
      || input.authorization!.length > 512 || input.url.searchParams.getAll("pin").length !== 1
      || input.url.searchParams.getAll("deviceId").length !== 1 || input.url.searchParams.getAll("time").length !== 1
      || !deviceTime || deviceTime.length > 64 || !pin || !PIN_PATTERN.test(pin)) {
      return { status: 200, body: DENY };
    }

    const pinFingerprint = createHash("sha256").update(`${config.akuvoxHardwareDeviceId}:${pin}`).digest("hex");
    for (const [fingerprint, expiresAt] of recentPins) if (expiresAt <= instant) recentPins.delete(fingerprint);
    if ((recentPins.get(pinFingerprint) ?? 0) > instant) return { status: 200, body: DENY };

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 1_800);
    try {
      const response = await fetcher(UPSTREAM, {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${config.r12DeviceSecret}`,
          "content-type": "application/json",
          "x-r12-device-id": config.r12DeviceId,
          "x-r12-request-nonce": randomUUID(),
          "x-r12-presented-at": new Date(instant).toISOString(),
        },
        body: JSON.stringify({ credential: pin, credentialType: "pin" }),
        cache: "no-store",
        signal: abort.signal,
      });
      if (!response.ok) return { status: 200, body: DENY };
      const decision = await response.json() as DecisionPayload;
      const isvalid = decision.allowed === true
        && decision.decision === "allow"
        && decision.unlockPermitted === true;
      if (isvalid) recentPins.set(pinFingerprint, instant + 10_000);
      return {
        status: 200,
        body: akuvoxA02Response({
          allowed: decision.allowed === true,
          decision: decision.decision === "allow" ? "allow" : "deny",
          unlockPermitted: decision.unlockPermitted === true,
        }),
      };
    } catch {
      // Do not log the incoming URL, PIN, Authorization value, or upstream
      // request. The keypad receives a deterministic deny on any failure.
      return { status: 200, body: DENY };
    } finally {
      clearTimeout(timer);
    }
  };
}

function send(response: ServerResponse, result: { status: number; body: string }) {
  response.writeHead(result.status, HEADERS);
  response.end(result.body);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Required configuration missing: ${name}`);
  return value;
}

function loadConfig(): Config {
  const certPath = required("AKUVOX_TLS_CERT_FILE");
  const keyPath = required("AKUVOX_TLS_KEY_FILE");
  const username = required("AKUVOX_BASIC_USERNAME");
  const password = required("AKUVOX_BASIC_PASSWORD");
  const deviceSecret = required("R12_DEVICE_SECRET");
  if (username.length < 12 || password.length < 24 || deviceSecret.length < 32) {
    throw new Error("Gateway credentials do not meet minimum length requirements");
  }
  const allowedIps = new Set(required("AKUVOX_ALLOWED_SOURCE_IPS").split(",").map((ip) => ip.trim()).filter(Boolean));
  if (!allowedIps.size || [...allowedIps].some((ip) => !isIPv4(ip))) {
    throw new Error("Configure exact IPv4 source address(es) for the keypad");
  }
  return {
    akuvoxHardwareDeviceId: required("AKUVOX_DEVICE_ID"),
    r12DeviceId: required("R12_DEVICE_ID"),
    r12DeviceSecret: deviceSecret,
    basicUsername: username,
    basicPassword: password,
    allowedIps,
    // Read key/cert at startup so bad/missing TLS material fails closed.
    tlsCertificate: readFileSync(certPath),
    tlsPrivateKey: readFileSync(keyPath),
  };
}

export function startAkuvoxGateway() {
  const config = loadConfig();
  if (!config.tlsCertificate || !config.tlsPrivateKey) throw new Error("TLS certificate and private key are required");
  const handler = createAkuvoxA02Handler(config);
  const server = createServer({ cert: config.tlsCertificate, key: config.tlsPrivateKey, minVersion: "TLSv1.2" }, async (request: IncomingMessage, response: ServerResponse) => {
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "https://gateway.invalid");
    } catch {
      send(response, { status: 200, body: DENY });
      return;
    }
    if (url.pathname !== "/akuvox/a02/pin") {
      send(response, { status: 404, body: DENY });
      return;
    }
    const result = await handler({
      method: request.method ?? "",
      url,
      authorization: request.headers.authorization ?? null,
      remoteAddress: request.socket.remoteAddress ?? "",
    });
    send(response, result);
  });
  const port = Number(process.env.AKUVOX_GATEWAY_PORT ?? "8443");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid gateway port");
  server.listen(port, "0.0.0.0");
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = startAkuvoxGateway();
  server.on("listening", () => {
    const address = server.address() as AddressInfo;
    // Only non-sensitive operational readiness is written. No request or
    // credential data is logged by this process.
    process.stdout.write(`Akuvox HTTPS gateway listening on port ${address.port}\n`);
  });
}
