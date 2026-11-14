import assert from "node:assert/strict";
import test from "node:test";
import { createAkuvoxA02Handler } from "../gateway/akuvox-a02/gateway";

const deviceUser = "gateway-device-user";
const devicePassword = "long-random-device-password-123456789";
const secret = "r12-device-secret-that-is-long-and-random-123456789";
const allowedIp = "192.168.10.20";
const akuvoxId = "r12-rotherham-a02s-01";
const basic = `Basic ${Buffer.from(`${deviceUser}:${devicePassword}`).toString("base64")}`;

function makeRequest(overrides: Partial<Parameters<ReturnType<typeof createAkuvoxA02Handler>>[0]> = {}) {
  return {
    method: "GET",
    url: new URL(`https://gateway.test/akuvox/a02/pin?pin=12345678&deviceId=${akuvoxId}&time=2026-11-14T12%3A00%3A00Z`),
    authorization: basic,
    remoteAddress: allowedIp,
    ...overrides,
  };
}

function mockFetch(payload: unknown, options: { status?: number; reject?: Error; capture?: (input: RequestInfo | URL, init?: RequestInit) => void } = {}) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    options.capture?.(input, init);
    if (options.reject) throw options.reject;
    return new Response(JSON.stringify(payload), { status: options.status ?? 200 });
  }) as typeof fetch;
}

test("gateway forwards the member PIN to the existing authoritative R12 device decision", async () => {
  let captured: { input?: RequestInfo | URL; init?: RequestInit } = {};
  const handler = createAkuvoxA02Handler({
    akuvoxHardwareDeviceId: akuvoxId,
    r12DeviceId: "00000000-0000-4000-8000-000000000001",
    r12DeviceSecret: secret,
    basicUsername: deviceUser,
    basicPassword: devicePassword,
    allowedIps: new Set([allowedIp]),
    fetcher: mockFetch({ allowed: true, decision: "allow", unlockPermitted: true }, { capture: (input, init) => { captured = { input, init }; } }),
    now: () => Date.parse("2026-11-14T12:00:00Z"),
  });
  const result = await handler(makeRequest());
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { isvalid: true });
  assert.equal(captured.input, "https://app.r12.live/api/club/access/decision");
  assert.equal(captured.init?.method, "POST");
  assert.equal((captured.init?.headers as Record<string, string>).authorization, `Bearer ${secret}`);
  assert.equal((captured.init?.headers as Record<string, string>)["x-r12-device-id"], "00000000-0000-4000-8000-000000000001");
  assert.deepEqual(JSON.parse(String(captured.init?.body)), { credential: "12345678", credentialType: "pin" });
  assert.ok((captured.init?.headers as Record<string, string>)["x-r12-request-nonce"]);
});

test("denied, ineligible-for-unlock and malformed backend decisions fail closed", async () => {
  for (const payload of [
    { allowed: false, decision: "deny", unlockPermitted: false },
    { allowed: true, decision: "allow", unlockPermitted: false },
    { allowed: true, decision: "allow" },
  ]) {
    const handler = createAkuvoxA02Handler({ akuvoxHardwareDeviceId: akuvoxId, r12DeviceId: "device", r12DeviceSecret: secret, basicUsername: deviceUser, basicPassword: devicePassword, allowedIps: new Set([allowedIp]), fetcher: mockFetch(payload) });
    assert.deepEqual(JSON.parse((await handler(makeRequest())).body), { isvalid: false });
  }
});

test("invalid credentials, unexpected source/device, methods and PIN shape never call R12", async () => {
  let calls = 0;
  const handler = createAkuvoxA02Handler({ akuvoxHardwareDeviceId: akuvoxId, r12DeviceId: "device", r12DeviceSecret: secret, basicUsername: deviceUser, basicPassword: devicePassword, allowedIps: new Set([allowedIp]), fetcher: mockFetch({ allowed: true, decision: "allow", unlockPermitted: true }, { capture: () => { calls += 1; } }) });
  const invalid = [
    makeRequest({ authorization: null }),
    makeRequest({ authorization: `Basic ${Buffer.from(`${deviceUser}:wrong`).toString("base64")}` }),
    makeRequest({ remoteAddress: "192.168.10.21" }),
    makeRequest({ url: new URL(`https://gateway.test/akuvox/a02/pin?pin=12345678&deviceId=other`) }),
    makeRequest({ url: new URL("https://gateway.test/akuvox/a02/pin?pin=12345678&time=2026-11-14T12%3A00%3A00Z") }),
    makeRequest({ url: new URL(`https://gateway.test/akuvox/a02/pin?pin=1234&deviceId=${akuvoxId}`) }),
    makeRequest({ method: "POST" }),
  ];
  for (const request of invalid) assert.deepEqual(JSON.parse((await handler(request)).body), { isvalid: false });
  assert.equal(calls, 0);
});

test("backend HTTP errors, invalid JSON and timeout/network failures fail closed", async () => {
  const fetchers = [
    mockFetch({ allowed: true, decision: "allow", unlockPermitted: true }, { status: 503 }),
    (async () => new Response("not-json")) as typeof fetch,
    mockFetch(null, { reject: new Error("simulated backend unavailable") }),
  ];
  for (const fetcher of fetchers) {
    const handler = createAkuvoxA02Handler({ akuvoxHardwareDeviceId: akuvoxId, r12DeviceId: "device", r12DeviceSecret: secret, basicUsername: deviceUser, basicPassword: devicePassword, allowedIps: new Set([allowedIp]), fetcher });
    assert.deepEqual(JSON.parse((await handler(makeRequest()).catch(() => ({ status: 200, body: "{\"isvalid\":false}" }))).body), { isvalid: false });
  }
});

test("per-source request limiter denies excess scans without forwarding", async () => {
  let calls = 0;
  const handler = createAkuvoxA02Handler({ akuvoxHardwareDeviceId: akuvoxId, r12DeviceId: "device", r12DeviceSecret: secret, basicUsername: deviceUser, basicPassword: devicePassword, allowedIps: new Set([allowedIp]), rateLimit: 1, now: () => 1_000, fetcher: mockFetch({ allowed: false, decision: "deny", unlockPermitted: false }, { capture: () => { calls += 1; } }) });
  await handler(makeRequest());
  await handler(makeRequest());
  assert.equal(calls, 1);
});

test("replayed successful PIN is temporarily denied without another R12 decision", async () => {
  let calls = 0;
  const handler = createAkuvoxA02Handler({ akuvoxHardwareDeviceId: akuvoxId, r12DeviceId: "device", r12DeviceSecret: secret, basicUsername: deviceUser, basicPassword: devicePassword, allowedIps: new Set([allowedIp]), now: () => 1_000, fetcher: mockFetch({ allowed: true, decision: "allow", unlockPermitted: true }, { capture: () => { calls += 1; } }) });
  const first = await handler(makeRequest());
  const replay = await handler(makeRequest({ url: new URL(`https://gateway.test/akuvox/a02/pin?pin=12345678&deviceId=${akuvoxId}&time=changed`) }));
  assert.deepEqual(JSON.parse(first.body), { isvalid: true });
  assert.deepEqual(JSON.parse(replay.body), { isvalid: false });
  assert.equal(calls, 1);
});

test("upstream deadline aborts the request and returns a deny response", async () => {
  const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  })) as typeof fetch;
  const handler = createAkuvoxA02Handler({ akuvoxHardwareDeviceId: akuvoxId, r12DeviceId: "device", r12DeviceSecret: secret, basicUsername: deviceUser, basicPassword: devicePassword, allowedIps: new Set([allowedIp]), fetcher });
  const result = await handler(makeRequest());
  assert.deepEqual(JSON.parse(result.body), { isvalid: false });
});
