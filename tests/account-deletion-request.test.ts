import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/2027-01-05-account-deletion-and-induction-stage-progress.sql", "utf8");
const route = readFileSync("app/api/account/deletion-request/route.ts", "utf8");
const component = readFileSync("components/account-deletion-request.tsx", "utf8");
const page = readFileSync("app/account/delete/page.tsx", "utf8");

test("account deletion records a private request and does not delete identity or business data", () => {
  assert.match(migration, /create table if not exists public\.account_deletion_requests/);
  assert.match(migration, /alter table public\.account_deletion_requests enable row level security/);
  assert.match(migration, /revoke all on table public\.account_deletion_requests from public, anon, authenticated/);
  assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/);
  assert.doesNotMatch(migration, /delete from auth\.users|delete from public\.(club_memberships|club_membership_billing_obligations)/i);
  assert.doesNotMatch(route, /deleteUser\(|delete from/i);
});

test("deletion requests require same-origin password reauthentication and explicit confirmation", () => {
  assert.match(route, /headers\.get\("origin"\) !== request\.nextUrl\.origin/);
  assert.match(route, /persistSession: false/);
  assert.match(route, /verified\.data\.user\?\.id !== user\.id/);
  assert.match(route, /confirmation !== "DELETE"/);
  assert.match(component, /confirmation !== "DELETE"/);
  assert.match(page, /AccountDeletionRequest/);
});

test("account deletion copy separates service cancellation and explains retained records", () => {
  assert.match(component, /does not cancel a gym membership, Direct Debit, Stripe subscription or other service/);
  assert.match(component, /retained or anonymised/);
  assert.match(component, /Your account remains active until processing is completed/);
});
