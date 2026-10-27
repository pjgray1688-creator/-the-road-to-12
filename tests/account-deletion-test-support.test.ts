import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  deletionTestPurpose,
  disposableDeletionTestEmail,
  disposableDeletionTestMarker,
  generateTemporaryDeletionTestPassword,
  isExactDisposableDeletionTestUser,
  provisionDisposableDeletionTestUser,
} from "../lib/account-deletion-test-account";
import { authorizeDeletionExecution, disposableTestNotificationSink } from "../lib/account-deletion-test-scope";

const requestId = "11111111-1111-4111-8111-111111111111";
const testUserId = "22222222-2222-4222-8222-222222222222";
const operatorId = "33333333-3333-4333-8333-333333333333";
const runId = "apple-glow-b5-01";

function user(overrides: Partial<User> = {}): User {
  return {
    id: testUserId,
    aud: "authenticated",
    role: "authenticated",
    email: disposableDeletionTestEmail(runId),
    email_confirmed_at: new Date().toISOString(),
    phone: "",
    app_metadata: { r12_disposable_test: disposableDeletionTestMarker(runId) },
    user_metadata: {},
    identities: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_anonymous: false,
    ...overrides,
  };
}

test("disposable identity uses a reserved address, strong generated password and server-controlled marker", () => {
  const password = generateTemporaryDeletionTestPassword();
  assert.equal(disposableDeletionTestEmail(runId), "r12-deletion-apple-glow-b5-01@example.test");
  assert.ok(password.length >= 48);
  assert.match(password, /[A-Z]/);
  assert.match(password, /[a-z]/);
  assert.match(password, /\d/);
  assert.match(password, /[^A-Za-z0-9]/);
  assert.equal(isExactDisposableDeletionTestUser(user(), runId), true);
  assert.equal(isExactDisposableDeletionTestUser(user({ email_confirmed_at: undefined }), runId), false);
  assert.equal(isExactDisposableDeletionTestUser(user({ email: "real@r12.live" }), runId), false);
});

test("admin provisioning preflights reuse, confirms without email and verifies the created identity", async () => {
  const calls: Array<{ name: string; value?: unknown }> = [];
  const createdUser = user();
  const admin = {
    listUsers: async () => ({ data: { users: [], nextPage: null }, error: null }),
    createUser: async (value: Record<string, unknown>) => {
      calls.push({ name: "createUser", value });
      return { data: { user: createdUser }, error: null };
    },
    getUserById: async () => ({ data: { user: createdUser }, error: null }),
    deleteUser: async () => { calls.push({ name: "deleteUser" }); return { error: null }; },
  };
  const credentials = await provisionDisposableDeletionTestUser(admin, runId);
  const attributes = calls.find(call => call.name === "createUser")?.value as Record<string, unknown>;
  assert.equal(attributes.email_confirm, true);
  assert.equal(attributes.email, disposableDeletionTestEmail(runId));
  assert.equal((attributes.app_metadata as Record<string, unknown>).r12_disposable_test instanceof Object, true);
  assert.equal(credentials.userId, testUserId);
  assert.equal(credentials.purpose, deletionTestPurpose);
  assert.equal(calls.some(call => call.name === "deleteUser"), false);
  assert.equal("inviteUserByEmail" in admin, false);
});

test("provisioning refuses to reuse an existing address and never calls createUser", async () => {
  let created = false;
  const admin = {
    listUsers: async () => ({ data: { users: [user()], nextPage: null }, error: null }),
    createUser: async () => { created = true; return { data: { user: null }, error: null }; },
    getUserById: async () => ({ data: { user: null }, error: null }),
    deleteUser: async () => ({ error: null }),
  };
  await assert.rejects(() => provisionDisposableDeletionTestUser(admin, runId), /will not be reused or overwritten/);
  assert.equal(created, false);
});

test("provisioning rolls back a newly created identity that fails marker verification", async () => {
  let deletedUserId = "";
  const admin = {
    listUsers: async () => ({ data: { users: [], nextPage: null }, error: null }),
    createUser: async () => ({ data: { user: user() }, error: null }),
    getUserById: async () => ({ data: { user: user({ app_metadata: {} }) }, error: null }),
    deleteUser: async (id: string) => { deletedUserId = id; return { error: null }; },
  };
  await assert.rejects(() => provisionDisposableDeletionTestUser(admin, runId), /rolled back/);
  assert.equal(deletedUserId, testUserId);
});

function scopedAdmin(target: User | null, state = "approved", secretUserId = testUserId) {
  return {
    rpc: async () => ({ data: { user_id: secretUserId, execution_state: state }, error: null }),
    auth: { admin: { getUserById: async () => target
      ? ({ data: { user: target }, error: null })
      : ({ data: { user: null }, error: { status: 404, code: "user_not_found" } }) } },
  } as unknown as SupabaseClient;
}

const scopedEnvironment = {
  R12_ACCOUNT_DELETION_EXECUTION_ENABLED: "false",
  R12_ACCOUNT_DELETION_TEST_USER_ID: testUserId,
  R12_ACCOUNT_DELETION_TEST_RUN_ID: runId,
};

test("disabled production execution authorizes only the exact marked disposable UUID", async () => {
  const allowed = await authorizeDeletionExecution(scopedAdmin(user()), requestId, operatorId, scopedEnvironment);
  assert.deepEqual(allowed, {
    mode: "disposable_test",
    runId,
    userId: testUserId,
    expectedEmail: disposableDeletionTestEmail(runId),
  });
  assert.equal(await authorizeDeletionExecution(scopedAdmin(user(), "approved", "99999999-9999-4999-8999-999999999999"), requestId, operatorId, scopedEnvironment), null);
  assert.equal(await authorizeDeletionExecution(scopedAdmin(user({ email: "member@r12.live" })), requestId, operatorId, scopedEnvironment), null);
  assert.equal(await authorizeDeletionExecution(scopedAdmin(user({ app_metadata: {} })), requestId, operatorId, scopedEnvironment), null);
  assert.equal(await authorizeDeletionExecution(scopedAdmin(null), requestId, operatorId, scopedEnvironment), null);
});

test("an absent Auth user is accepted only for exact post-deletion notification recovery", async () => {
  const retry = await authorizeDeletionExecution(scopedAdmin(null, "notification_pending"), requestId, operatorId, scopedEnvironment);
  assert.equal(retry?.mode, "disposable_test");
  assert.equal(await authorizeDeletionExecution(scopedAdmin(null, "failed"), requestId, operatorId, scopedEnvironment), null);
});

test("disposable notification sink accepts only the deterministic test address", async () => {
  const authorization = await authorizeDeletionExecution(scopedAdmin(user()), requestId, operatorId, scopedEnvironment);
  assert.ok(authorization?.mode === "disposable_test");
  if (!authorization || authorization.mode !== "disposable_test") return;
  const deliver = disposableTestNotificationSink(authorization);
  const base = { id: `account-deletion-${requestId}`, sender: "privacy" as const, subject: "Deleted", text: "Deleted", html: "<p>Deleted</p>" };
  const accepted = await deliver({ ...base, recipientEmail: disposableDeletionTestEmail(runId) });
  const rejected = await deliver({ ...base, recipientEmail: "someone@r12.live" });
  assert.equal(accepted.ok, true);
  assert.match(accepted.ok ? accepted.reference : "", /^disposable-test:/);
  assert.equal(rejected.ok, false);
});

test("provisioning CLI keeps credentials outside Git and never logs secret values", () => {
  const source = readFileSync("scripts/provision-account-deletion-test-user.ts", "utf8");
  const accountSource = readFileSync("lib/account-deletion-test-account.ts", "utf8");
  assert.match(source, /openSync\(config\.outputPath, "wx", 0o600\)/);
  assert.match(source, /writeFileSync\(descriptor/);
  assert.match(source, /CREATE_ONE_DISPOSABLE_ACCOUNT/);
  assert.match(accountSource, /email_confirm: true/);
  assert.doesNotMatch(`${source}\n${accountSource}`, /inviteUserByEmail|generateLink/);
  assert.doesNotMatch(source, /credentials\.password|SERVICE_ROLE_KEY.*stdout|console\.log\(.*password/);
});
