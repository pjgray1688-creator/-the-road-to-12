import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { authReturnUrlWithoutCredentials, exchangeAuthCodeSession, exchangePasswordRecoverySession, passwordRecoveryLink, verifyPasswordRecoveryToken } from "../lib/auth-url-session";
import { passwordRecoveryDestination } from "../lib/auth-return";
import { proxy } from "../proxy";

function authClient(redirectType: string | null, authenticatedUserId = "user-1") {
  const calls: Array<{ code: string; flowId?: string; operation: string }> = [];
  const client = {
    auth: {
      async exchangeCodeForSession(code: string, options?: { flowId?: string }) {
        calls.push({ code, flowId: options?.flowId, operation: "exchange" });
        return { data: { session: { user: { id: "user-1" } }, user: { id: "user-1" }, redirectType }, error: null };
      },
      async getUser() {
        calls.push({ code: "", operation: "validate" });
        return { data: { user: { id: authenticatedUserId, email_confirmed_at: "2026-10-26T12:00:00Z" } }, error: null };
      },
    },
  };
  return { client, calls };
}

test("fresh recovery code is exchanged once before the resulting Auth identity is accepted", async () => {
  const { client, calls } = authClient("recovery");
  const result = await exchangePasswordRecoverySession(client as never, "https://app.r12.live/account/reset?app=glow&next=%2Fglow-zone&code=fresh-code&sb_flow_id=flow-1");
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    { code: "fresh-code", flowId: "flow-1", operation: "exchange" },
    { code: "", operation: "validate" },
  ]);
});

test("a valid non-recovery session cannot unlock password replacement", async () => {
  const { client } = authClient(null);
  assert.equal((await exchangePasswordRecoverySession(client as never, "https://app.r12.live/account/reset?code=signup-code")).ok, false);
});

test("the exchanged session and server-validated user must be the same identity", async () => {
  const { client } = authClient("recovery", "other-user");
  assert.equal((await exchangeAuthCodeSession(client as never, "https://app.r12.live/account/reset?code=fresh-code")).ok, false);
});

test("a failed one-time exchange cannot fall back to an unrelated existing session", async () => {
  let validatedExistingSession = false;
  const client = { auth: {
    async exchangeCodeForSession() { return { data: { session: null, user: null }, error: new Error("consumed") }; },
    async getUser() { validatedExistingSession = true; return { data: { user: { id: "existing-user" } }, error: null }; },
  } };
  assert.equal((await exchangePasswordRecoverySession(client as never, "https://app.r12.live/account/reset?code=consumed-code")).ok, false);
  assert.equal(validatedExistingSession, false);
});

test("one-time recovery credentials are removed without losing Glow context", () => {
  assert.equal(
    authReturnUrlWithoutCredentials("https://app.r12.live/account/reset?app=glow&next=%2Fglow-zone&code=secret&sb_flow_id=flow-1#access_token=secret"),
    "/account/reset?app=glow&next=%2Fglow-zone",
  );
});

test("email-link preview only moves the token out of the server-visible query and does not consume it", () => {
  const request = new NextRequest("https://app.r12.live/account/reset?token_hash=hashed-secret&type=recovery&redirect_to=https%3A%2F%2Fapp.r12.live%2Faccount%2Freset%3Fapp%3Dglow%26next%3D%252Fglow-zone");
  const response = proxy(request);
  assert.equal(response.status, 307);
  const redirected = new URL(response.headers.get("location")!);
  assert.equal(redirected.searchParams.has("token_hash"), false);
  assert.equal(redirected.hash, "#token_hash=hashed-secret&type=recovery");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("a recovery token is parsed without verification and is consumed exactly once when requested", async () => {
  const parsed = passwordRecoveryLink("https://app.r12.live/account/reset?app=glow#token_hash=hashed-secret&type=recovery");
  assert.deepEqual(parsed, { kind: "token", tokenHash: "hashed-secret", type: "recovery" });
  const calls: string[] = [];
  const client = { auth: {
    async verifyOtp(input: { token_hash: string; type: string }) { calls.push(`verify:${input.type}:${input.token_hash}`); return { data: { session: { user: { id: "user-1" } } }, error: null }; },
    async getUser() { calls.push("validate"); return { data: { user: { id: "user-1" } }, error: null }; },
  } };
  assert.equal((await verifyPasswordRecoveryToken(client as never, parsed.tokenHash, parsed.type)).ok, true);
  assert.deepEqual(calls, ["verify:recovery:hashed-secret", "validate"]);
});

test("expired and wrong-purpose token hashes fail closed", async () => {
  let calls = 0;
  const expiredClient = { auth: {
    async verifyOtp() { calls += 1; return { data: { session: null }, error: new Error("expired") }; },
    async getUser() { throw new Error("must not validate a failed OTP"); },
  } };
  assert.equal((await verifyPasswordRecoveryToken(expiredClient as never, "expired-hash", "recovery")).ok, false);
  assert.equal((await verifyPasswordRecoveryToken(expiredClient as never, "signup-hash", "signup")).ok, false);
  assert.equal(calls, 1);
});

test("token verification requires the returned session and validated user to match", async () => {
  const client = { auth: {
    async verifyOtp() { return { data: { session: { user: { id: "user-1" } } }, error: null }; },
    async getUser() { return { data: { user: { id: "other-user" } }, error: null }; },
  } };
  assert.equal((await verifyPasswordRecoveryToken(client as never, "hash", "recovery")).ok, false);
});

test("nested reset destinations retain each app while rejecting unsafe continuations", () => {
  const cases = [["training", "/"], ["club", "/club"], ["coach", "/coach"], ["glow", "/glow-zone"]] as const;
  for (const [app, next] of cases) {
    const redirect_to = `https://app.r12.live/account/reset?app=${app}&next=${encodeURIComponent(next)}`;
    assert.deepEqual(passwordRecoveryDestination({ redirect_to }), { app, next });
  }
  assert.deepEqual(passwordRecoveryDestination({ redirect_to: "https://evil.test/account/reset?app=glow&next=https://evil.test" }), { app: "glow", next: "/glow-zone" });
});

test("password update remains gated behind the validated recovery state", () => {
  const component = readFileSync("components/reset-password-client.tsx", "utf8");
  assert.match(component, /status !== "ready"/);
  assert.match(component, /supabase\.auth\.updateUser\(\{ password \}\)/);
  assert.match(component, /Continue to reset password/);
  assert.match(component, /verifyPasswordRecoveryToken/);
});
