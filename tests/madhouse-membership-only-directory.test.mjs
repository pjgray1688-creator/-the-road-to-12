import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-12-17-madhouse-membership-only-directory.sql", "utf8");
const membersPage = readFileSync("app/club/members/page.tsx", "utf8");
const directory = readFileSync("components/club-members-directory.tsx", "utf8");
const repository = readFileSync("lib/supabase-club-repository.ts", "utf8");

test("account-linked directory entries require a real membership holder and membership row", () => {
  assert.match(migration, /from public\.club_memberships ms[\s\S]*join public\.club_membership_holders h/);
  assert.match(migration, /and exists\([\s\S]*from public\.club_memberships ms[\s\S]*h\.user_id=m\.user_id or hc\.user_id=m\.user_id/);
  assert.doesNotMatch(migration, /where m\.organisation_id=p_organisation_id and m\.active\s*\)/);
});

test("former and paused membership states are retained and shown with their actual status", () => {
  for (const state of ["active", "pending", "paused", "suspended", "expired", "cancelled"]) {
    assert.ok(migration.includes(`when '${state}' then`), `missing ${state} ordering`);
  }
  assert.match(migration, /membership_status',history\.status/);
  assert.match(directory, /membershipLabel\(member\.membershipStatus\)/);
});

test("unlinked customers appear only when a membership holder record exists", () => {
  assert.match(migration, /club_list_unlinked_membership_customers\(p_organisation_id uuid\)/);
  assert.match(migration, /where h\.organisation_id=p_organisation_id and h\.customer_id=c\.id/);
  assert.match(migration, /where c\.organisation_id=p_organisation_id and c\.user_id is null/);
  assert.match(membersPage, /club_list_unlinked_membership_customers/);
});

test("staff and Coach access alone do not qualify, while genuine managers can also be members", () => {
  assert.match(migration, /from public\.club_members m[\s\S]*where m\.organisation_id=p_organisation_id[\s\S]*and exists\(/);
  assert.doesNotMatch(migration, /insert into public\.club_memberships|update public\.club_memberships|delete from public\.club_memberships/);
  assert.match(membersPage, /ClubMembersDirectory members=\{members\}/);
});

test("full customer list remains available to membership assignment, but directory receives filtered records", () => {
  assert.match(membersPage, /ClubMemberOnboarding[\s\S]*customers=\{customers\}/);
  assert.match(membersPage, /customers=\{unlinkedMembershipCustomers\}/);
  assert.match(repository, /customerId: String\(x\.customer_id\)/);
  assert.match(directory, /member\.customerId \? `\/club\/members\/customer\//);
});
