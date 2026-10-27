import assert from "node:assert/strict";
import test from "node:test";
import { authReturnUrlWithoutCredentials, exchangeAuthCodeSession, exchangePasswordRecoverySession } from "../lib/auth-url-session";

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
