import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/2026-10-20-account-deletion-requests.sql", "utf8");
const route = readFileSync("app/api/account/deletion-request/route.ts", "utf8");
const component = readFileSync("components/account-deletion-request.tsx", "utf8");
const page = readFileSync("app/account/delete/page.tsx", "utf8");

test("account deletion records a private request before separately approved execution", () => {
  assert.match(migration, /create table if not exists public\.account_deletion_requests/);
  assert.match(migration, /alter table public\.account_deletion_requests enable row level security/);
  assert.match(migration, /revoke all on table public\.account_deletion_requests from public, anon, authenticated/);
  assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(migration, /response_due_at timestamptz not null default \(now\(\) \+ interval '1 month'\)/);
  assert.match(migration, /account_deletion_request_events/);
  assert.match(migration, /retention_reviewed boolean not null default false/);
  assert.match(migration, /eligible_data_processed boolean not null default false/);
  assert.match(migration, /to_jsonb\(old\)-'actor_user_id'\)=\(to_jsonb\(new\)-'actor_user_id'\)/);
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
  assert.match(page, /Delete your R12 account/);
  assert.match(component, /may affect access to every connected R12 application/);
  assert.match(component, /does not automatically cancel it/);
  assert.match(component, /If you have a linked gym membership, recurring payment agreement or other service/);
  assert.doesNotMatch(component, /Madhouse|Direct Debit|Stripe/i);
  assert.match(component, /retained or anonymised/);
  assert.match(component, /Your R12 account remains active until Auth identity removal is confirmed/);
});

test("deletion operators are named, server allowlisted and cannot attest completion manually", () => {
  const route = readFileSync("app/api/account/deletion-requests/route.ts", "utf8");
  const executorMigration = readFileSync("supabase/migrations/2027-01-22-account-deletion-executor.sql", "utf8");
  assert.match(readFileSync("lib/privacy-operator.ts", "utf8"), /R12_PRIVACY_OPERATOR_ALLOWLIST/);
  assert.match(route, /r12_approve_account_deletion/);
  assert.match(executorMigration, /Use the reviewed two-person account deletion workflow/);
});


test("launch manifest schedules account deletion before November and Club stage checks after their schema dependency", () => {
  const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
  assert.ok(manifest.indexOf("2026-10-20-account-deletion-requests.sql") < manifest.indexOf("2026-11-01-reconcile-statement-timings.sql"));
  assert.ok(manifest.indexOf("2026-12-13-member-age-induction-access-eligibility.sql") < manifest.indexOf("2026-12-14-club-induction-stage-progress.sql"));
  assert.doesNotMatch(manifest, /2027-01-05-account-deletion-and-induction-stage-progress/);
  assert.ok(manifest.indexOf("2027-01-21-glow-customer-self-registration.sql") < manifest.indexOf("2027-01-22-account-deletion-executor.sql"));
});
