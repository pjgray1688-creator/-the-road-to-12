import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptDeletionAddress, encryptDeletionAddress } from "../lib/account-deletion-crypto";
import { executeAccountDeletion } from "../lib/account-deletion-executor";

const migration = readFileSync("supabase/migrations/2027-01-22-account-deletion-executor.sql", "utf8");
const route = readFileSync("app/api/account/deletion-requests/route.ts", "utf8");
const runbook = readFileSync("docs/account-deletion-operations.md", "utf8");
const requestId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const operatorId = "33333333-3333-4333-8333-333333333333";

process.env.R12_PRIVACY_NOTIFICATION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

function fakeAdmin(options: { held?: boolean; storageFailure?: boolean; authFailure?: boolean; authAlreadyDeleted?: boolean } = {}) {
  const calls: string[] = [];
  const cipher = encryptDeletionAddress("verified@example.test");
  const admin = {
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "r12_get_account_deletion_execution_secret") return { data: { request_id: requestId, user_id: userId, execution_state: "approved", notification_ciphertext: cipher, notification_expires_at: new Date(Date.now() + 60_000).toISOString() }, error: null };
      if (name === "r12_prepare_account_deletion") return { data: options.held ? { state: "held", blockers: [{ code: "retention_hold" }] } : { state: "data_prepared", storage_objects: [{ bucket_id: "private", name: `${userId}/proof.jpg` }] }, error: null };
      if (name === "r12_claim_account_deletion_notification") return { data: { state: "notification_sending", delivery_token: "44444444-4444-4444-8444-444444444444" }, error: null };
      if (name === "r12_complete_account_deletion") return { data: { state: "completed" }, error: null };
      return { data: { state: "ok" }, error: null };
    },
    storage: { from: () => ({ remove: async () => { calls.push("storage.remove"); return { error: options.storageFailure ? new Error("no") : null }; } }) },
    auth: { admin: {
      deleteUser: async (id: string) => { calls.push(`auth.delete:${id}`); return { error: options.authFailure ? { code: "provider_failure", status: 503 } : options.authAlreadyDeleted ? { code: "user_not_found", status: 404 } : null }; },
      getUserById: async () => ({ data: { user: null }, error: { code: "user_not_found", status: 404 } }),
    } },
  };
  return { admin: admin as unknown as SupabaseClient, calls };
}

test("completion address is authenticated-encrypted and tampering fails", () => {
  const encrypted = encryptDeletionAddress("verified@example.test");
  assert.doesNotMatch(encrypted, /verified|example/);
  assert.equal(decryptDeletionAddress(encrypted), "verified@example.test");
  assert.throws(() => decryptDeletionAddress(`${encrypted.slice(0, -1)}x`));
});

test("approved execution removes reviewed storage, Auth identity, validates, notifies, then completes", async () => {
  const { admin, calls } = fakeAdmin();
  let recipient = "";
  const result = await executeAccountDeletion(admin, requestId, operatorId, { deliver: async envelope => { recipient = envelope.recipientEmail; return { ok: true, provider: "test", reference: "delivery-123" }; } });
  assert.deepEqual(result, { state: "completed" });
  assert.equal(recipient, "verified@example.test");
  assert.ok(calls.indexOf("storage.remove") < calls.indexOf(`auth.delete:${userId}`));
  assert.ok(calls.indexOf("r12_confirm_account_deletion_identity") < calls.indexOf("r12_complete_account_deletion"));
  assert.ok(calls.indexOf("r12_claim_account_deletion_notification") < calls.indexOf("r12_complete_account_deletion"));
});

test("a dependency hold performs no Storage or Auth deletion", async () => {
  const { admin, calls } = fakeAdmin({ held: true });
  const result = await executeAccountDeletion(admin, requestId, operatorId);
  assert.equal((result as { state: string }).state, "held");
  assert.equal(calls.some(call => call.startsWith("auth.delete") || call === "storage.remove"), false);
});

test("Storage failure records failure and stops before Auth deletion", async () => {
  const { admin, calls } = fakeAdmin({ storageFailure: true });
  await assert.rejects(() => executeAccountDeletion(admin, requestId, operatorId), /storage_removal_failed/);
  assert.ok(calls.includes("r12_fail_account_deletion"));
  assert.equal(calls.some(call => call.startsWith("auth.delete")), false);
});

test("an already absent Auth identity is an idempotent recovery, while provider failure remains incomplete", async () => {
  const recovered = fakeAdmin({ authAlreadyDeleted: true });
  const result = await executeAccountDeletion(recovered.admin, requestId, operatorId, { deliver: async () => ({ ok: true, provider: "test", reference: "delivery-456" }) });
  assert.equal((result as { state: string }).state, "completed");
  const failed = fakeAdmin({ authFailure: true });
  await assert.rejects(() => executeAccountDeletion(failed.admin, requestId, operatorId), /auth_identity_deletion_failed/);
  assert.ok(failed.calls.includes("r12_fail_account_deletion"));
  assert.equal(failed.calls.includes("r12_complete_account_deletion"), false);
});

test("notification failure releases only its claim and never marks deletion completed", async () => {
  const { admin, calls } = fakeAdmin();
  const result = await executeAccountDeletion(admin, requestId, operatorId, { deliver: async () => ({ ok: false, state: "failed", code: "smtp_failed", message: "safe", retryable: true }) });
  assert.equal((result as { state: string }).state, "notification_pending");
  assert.ok(calls.includes("r12_release_account_deletion_notification"));
  assert.equal(calls.includes("r12_complete_account_deletion"), false);
});

test("migration enforces two people, exact-UUID scope, holds and immutable audit", () => {
  assert.match(migration, /r\.reviewed_by=p_operator_id/);
  assert.match(migration, /r\.reviewed_by=r\.approved_by/);
  assert.match(migration, /account_deletion_execution_events_immutable/);
  assert.match(migration, /unreviewed_dependency/);
  assert.match(migration, /retention_hold/);
  assert.match(migration, /where %I=\$1/);
  assert.match(migration, /club_customers.*anonymize_customer/s);
  assert.match(migration, /storage\.objects/);
  assert.match(migration, /whoop_connections.*delete/s);
  assert.match(migration, /nutrition_plans.*client_user_id.*delete/s);
  assert.match(migration, /coach_session_logs.*client_user_id.*delete/s);
  assert.match(migration, /club_glow_age_verifications.*archive_glow_age/s);
  assert.match(migration, /club_glow_session_requests.*unlink/s);
  assert.match(migration, /Cross-account isolation validation failed/);
  assert.match(migration, /restrictive Auth dependency/);
  assert.match(migration, /notification_expires_at<=now\(\).*notification_ciphertext is not null/s);
  assert.doesNotMatch(migration, /update\s+public\.(club_memberships|stripe_|gocardless_)/i);
});

test("operator route requires server allowlist, fresh password and independent RPC approval", () => {
  assert.match(route, /privacyOperatorFromUser/);
  assert.match(route, /signInWithPassword/);
  assert.match(route, /r12_approve_account_deletion/);
  assert.match(route, /email_confirmed_at/);
  assert.match(route, /executeAccountDeletion/);
  assert.match(route, /R12_ACCOUNT_DELETION_EXECUTION_ENABLED !== "true"/);
  assert.doesNotMatch(route, /body.*role/i);
});

test("operations runbook requires disposable-project cross-account and member\/staff verification", () => {
  assert.match(runbook, /disposable Supabase project/);
  assert.match(runbook, /linked Glow customers/);
  assert.match(runbook, /staff identity/);
  assert.match(runbook, /control-user digests\/counts unchanged/);
  assert.match(runbook, /does not cancel gym memberships/);
});

