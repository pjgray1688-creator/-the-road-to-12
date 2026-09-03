import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/2026-09-12-club-membership-lifecycle.sql", "utf8");

test("guest membership migration supports customer holders and safe same-org keys", () => {
  assert.match(migration, /customer_id uuid/);
  assert.match(migration, /membership_id, organisation_id/);
  assert.match(migration, /assignment_idempotency_key/);
  assert.match(migration, /club_assign_membership/);
  assert.match(migration, /club_end_membership/);
});

test("membership lifecycle RPCs are protected and linking materialises grants", () => {
  assert.match(migration, /revoke all on function public\.club_assign_membership[^;]+from public,anon/i);
  assert.match(migration, /grant execute on function public\.club_assign_membership[^;]+to authenticated/i);
  assert.match(migration, /club_link_customer_user/);
  assert.match(migration, /club_entitlement_grants/);
  assert.match(migration, /end_requested_at/);
  assert.match(migration, /p_customer_id is not null and v_customer\.user_id is null then insert/);
  assert.match(migration, /v_customer\.user_id is not null/);
  assert.match(migration, /already contains that user|existing\.user_id=p_user_id/);
});

test("onboarding does not require an account before recording membership", () => {
  const source = readFileSync("components/club-member-onboarding.tsx", "utf8");
  assert.doesNotMatch(source, /before assigning a membership/);
  assert.match(source, /membership can be recorded now/);
});
