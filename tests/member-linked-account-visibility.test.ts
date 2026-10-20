import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-12-31-recognise-linked-members-without-membership.sql", "utf8");
const claim = readFileSync("components/club-member-claim.tsx", "utf8");
const memberHub = readFileSync("components/member-hub.tsx", "utf8");

test("staff-linked customers resolve by organisation-scoped auth user ID before email matching", () => {
  const linkedLookup = migration.indexOf("where organisation_id=p_organisation_id and user_id=auth.uid()");
  const emailLookup = migration.indexOf("select count(*) into v_count");
  assert.ok(linkedLookup >= 0 && emailLookup > linkedLookup);
  assert.match(migration, /'state','already_linked','customer_id',c\.id/);
  assert.match(claim, /claim\.state === "already_linked"/);
  assert.match(claim, /R12 account linked/);
  assert.doesNotMatch(claim.slice(0, claim.indexOf("if (claim.state !== \"ready\"")), /Staff verification needed/);
});

test("a linked customer without a membership remains visible in Member Area without receiving access", () => {
  const listMyMemberships = migration.slice(migration.indexOf("create or replace function public.club_list_my_memberships"));
  assert.match(listMyMemberships, /from public\.club_customers c/);
  assert.match(listMyMemberships, /c\.user_id=auth\.uid\(\)/);
  assert.match(listMyMemberships, /'membership',null/);
  assert.match(listMyMemberships, /not exists \([\s\S]*club_membership_holders/);
  assert.match(listMyMemberships, /revoke all on function public\.club_list_my_memberships\(\) from public,anon/);
  assert.match(memberHub, /No active membership\./);
  assert.doesNotMatch(listMyMemberships, /insert into public\.(club_memberships|club_entitlement_grants)/i);
});

test("staff account linking retains existing capability, organisation and audit boundaries", () => {
  const original = readFileSync("supabase/migrations/2026-11-18-member-acquisition-onboarding.sql", "utf8");
  assert.match(original, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.link_account'\)/);
  assert.match(original, /p_customer_id uuid[\s\S]*organisation_id=p_organisation_id/);
  assert.match(original, /'member\.account_staff_linked'/);
  assert.match(migration, /where organisation_id=p_organisation_id and user_id=auth\.uid\(\)/);
});
