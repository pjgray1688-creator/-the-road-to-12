import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("reception member actions use the live capability boundary", () => {
  const source = readFileSync("app/club/members/actions.ts", "utf8");
  assert.match(source, /hasCapability\(context\.organisation\.id, user\.id, "members\.create"\)/);
  assert.match(source, /hasCapability\(context\.organisation\.id, user\.id, "members\.link_account"\)/);
  assert.match(source, /hasCapability\(context\.organisation\.id, user\.id, "memberships\.assign"\)/);
  assert.match(source, /hasCapability\(context\.organisation\.id, user\.id, "memberships\.end_immediately"\)/);
  assert.match(source, /effectiveAt <= Date\.now\(\)/);
});

test("account linking delegates verified identity and organisation checks to the authoritative RPC", () => {
  const source = readFileSync("app/club/members/actions.ts", "utf8");
  const migration = readFileSync("supabase/migrations/2026-11-18-member-acquisition-onboarding.sql", "utf8");
  assert.match(source, /club_staff_link_member_account/);
  assert.match(migration, /email_confirmed_at is not null/);
  assert.match(migration, /id=p_customer_id and organisation_id=p_organisation_id/);
  assert.match(migration, /already linked to another member/);
});

test("repository capability helper calls the authenticated-actor RPC", () => {
  const source = readFileSync("lib/supabase-club-repository.ts", "utf8");
  assert.match(source, /rpc\("club_capability_allowed"/);
  assert.match(source, /p_user_id: userId/);
});
