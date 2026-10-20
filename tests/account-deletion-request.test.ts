import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/2026-10-20-account-deletion-requests.sql", "utf8");
const route = readFileSync("app/api/account/deletion-request/route.ts", "utf8");
const component = readFileSync("components/account-deletion-request.tsx", "utf8");
const page = readFileSync("app/account/delete/page.tsx", "utf8");

test("account deletion records a private request and does not delete identity or business data", () => {
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
  assert.match(component, /does not cancel a gym membership, Direct Debit, Stripe subscription or other service/);
  assert.match(component, /retained or anonymised/);
  assert.match(component, /Your account remains active until processing is completed/);
});

test("deletion operators are server allowlisted and completion is retention-attested", () => {
  const route = readFileSync("app/api/account/deletion-requests/route.ts", "utf8");
  assert.match(route, /R12_PRIVACY_OPERATOR_USER_IDS/);
  assert.match(route, /r12_process_account_deletion_request/);
  assert.match(migration, /Complete the retention review and eligible-data processing before confirmation/);
});


test("launch manifest schedules account deletion before November and Club stage checks after their schema dependency", () => {
  const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
  assert.ok(manifest.indexOf("2026-10-20-account-deletion-requests.sql") < manifest.indexOf("2026-11-01-reconcile-statement-timings.sql"));
  assert.ok(manifest.indexOf("2026-12-13-member-age-induction-access-eligibility.sql") < manifest.indexOf("2026-12-14-club-induction-stage-progress.sql"));
  assert.doesNotMatch(manifest, /2027-01-05-account-deletion-and-induction-stage-progress/);
});
