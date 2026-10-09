import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/2026-12-12-membership-access-lifecycle.sql", "utf8");
const action = readFileSync("app/club/members/actions.ts", "utf8");
const memberPage = readFileSync("app/club/members/[userId]/page.tsx", "utf8");
const customerPage = readFileSync("app/club/members/customer/[customerId]/page.tsx", "utf8");
const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");

test("membership access pause/reactivation is transactional, capability-gated and auditable", () => {
  assert.match(migration, /club_capability_allowed\(p_organisation_id, auth\.uid\(\), 'memberships\.end_immediately'\)/);
  assert.match(migration, /from public\.club_memberships[\s\S]*?for update/);
  assert.match(migration, /insert into public\.club_membership_access_events/);
  assert.match(migration, /set status = p_status/);
  assert.match(migration, /check \(previous_status <> new_status\)/);
  assert.match(migration, /revoke all on function public\.club_set_membership_access_status[^;]+from public, anon/i);
  assert.match(migration, /grant execute on function public\.club_set_membership_access_status[^;]+to authenticated/i);
});

test("membership access cannot be reactivated outside a valid term or after terminal status", () => {
  assert.match(migration, /Only an active membership can be paused/);
  assert.match(migration, /Only a paused membership can be reactivated/);
  assert.match(migration, /ends_at <= now\(\)/);
  assert.match(migration, /starts_at > now\(\)/);
  assert.match(migration, /p_status is null or p_status not in \('active', 'paused'\)/);
});

test("staff and unlinked customer profiles expose only capability-authorized lifecycle controls", () => {
  assert.match(action, /hasCapability\(context\.organisation\.id, user\.id, "memberships\.end_immediately"\)/);
  assert.match(action, /club_set_membership_access_status/);
  assert.match(memberPage, /canChangeMembershipAccess/);
  assert.match(customerPage, /club_list_customer_memberships/);
  assert.match(customerPage, /ClubMembershipAccessStatus/);
  assert.match(customerPage, /Pausing access does not change recurring billing/);
});

test("customer membership lookup is organisation- and capability-scoped; migration is ordered after live refunds", () => {
  assert.match(migration, /club_capability_allowed\(p_organisation_id, auth\.uid\(\), 'members\.view'\)/);
  assert.match(migration, /c\.id = p_customer_id and c\.organisation_id = p_organisation_id/);
  assert.ok(manifest.indexOf("2026-12-11-club-pos-line-refunds.sql") < manifest.indexOf("2026-12-12-membership-access-lifecycle.sql"));
});
