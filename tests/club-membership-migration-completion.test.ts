import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clubMembershipStatusMatches, formatClubMemberDisplayName } from "../lib/club-member-directory";
import { membershipManagementGroups } from "../lib/club-membership-categories";
import type { ClubProduct } from "../lib/club";

const migration = readFileSync("supabase/migrations/2027-01-31-club-historical-membership-review.sql", "utf8");
const membershipsPage = readFileSync("app/club/memberships/page.tsx", "utf8");

test("member directory views separate active, lapsed, former, pending review and all", () => {
  assert.equal(clubMembershipStatusMatches("active", "active"), true);
  assert.equal(clubMembershipStatusMatches("expired", "lapsed"), true);
  assert.equal(clubMembershipStatusMatches("cancelled", "former"), true);
  assert.equal(clubMembershipStatusMatches(undefined, "pending_review"), true);
  assert.equal(clubMembershipStatusMatches("active", "all"), true);
  assert.equal(clubMembershipStatusMatches("active", "lapsed"), false);
});

test("display-name cleanup preserves genuine spelling, diacritics and case", () => {
  assert.equal(formatClubMemberDisplayName("  de la Cruz   ÉLODIE  "), "de la Cruz ÉLODIE");
  assert.equal(formatClubMemberDisplayName("  O’Neill  "), "O’Neill");
});

test("management category groups include products regardless of public sale state", () => {
  const products = [
    { id: "a", organisationId: "org", name: "Off Peak", kind: "membership", sellable: false, priceMinor: 0, currency: "GBP", billing: "recurring" },
    { id: "b", organisationId: "org", name: "Family Membership", kind: "membership", sellable: false, priceMinor: 0, currency: "GBP", billing: "recurring" },
    { id: "c", organisationId: "org", name: "One Day Pass", kind: "membership", sellable: true, priceMinor: 500, currency: "GBP", billing: "one_off", durationDays: 1 },
    { id: "d", organisationId: "org", name: "PT Session", kind: "pt", sellable: true, priceMinor: 3000, currency: "GBP", billing: "one_off" },
  ] as ClubProduct[];
  const groups = membershipManagementGroups(products);
  assert.deepEqual(groups.find(group => group.key === "off_peak")?.products.map(product => product.id), ["a"]);
  assert.deepEqual(groups.find(group => group.key === "family")?.products.map(product => product.id), ["b"]);
  assert.deepEqual(groups.find(group => group.key === "passes")?.products.map(product => product.id), ["c"]);
  assert.equal(groups.flatMap(group => group.products).some(product => product.id === "d"), false);
  assert.deepEqual(groups.map(group => group.label).slice(0, 6), ["Off-Peak", "Family", "Couples", "Standard", "Lifetime", "Passes"]);
});

test("family terms page uses the secure projection rather than querying a revoked table", () => {
  assert.match(membershipsPage, /club_list_family_contracts_secure/);
  assert.doesNotMatch(membershipsPage, /from\("club_membership_shared_contracts"\)/);
  assert.match(migration, /public\.club_list_family_contracts_secure/);
  assert.match(migration, /memberships\.pricing_sensitive/);
  assert.match(migration, /revoke all on function public\.club_list_family_contracts_secure\(uuid\) from public,anon/);
});

test("historical directory includes profiles with no membership as pending review without granting access", () => {
  assert.match(migration, /c\.organisation_id=p_organisation_id\s+and \(source_offer\.import_row_id is not null or history\.status is not null\)/);
  assert.match(migration, /history\.starts_at<=now\(\).*'active'/s);
  assert.match(migration, /when history\.status is null or history\.status='pending' then 'pending_review'\s+else history\.status end/);
  assert.match(migration, /holder\.customer_id=c\.id/);
  assert.match(migration, /history\.status is null or history\.status='pending' then 'pending_review'/);
  assert.match(migration, /'directory_status'/);
  assert.match(migration, /public\.club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.view'\)/);
  assert.match(migration, /source_offer\.import_row_id is not null or history\.status is not null/);
  assert.doesNotMatch(migration, /insert into public\.club_entitlement_grants|insert into public\.club_memberships|insert into auth\.users/);
});

test("migration checks import, family contract, membership and audit prerequisites before defining RPCs", () => {
  for (const [table, column] of [
    ["club_member_import_rows", "source_row_number"], ["club_member_import_rows", "imported_membership_id"],
    ["club_member_import_identities", "source_member_reference"], ["club_member_import_package_mappings", "source_package"],
    ["club_membership_holders", "customer_id"], ["club_membership_shared_contracts", "agreed_amount_minor"],
    ["club_audit_events", "actor_role"],
  ]) assert.match(migration, new RegExp(`\\('${table}','${column}'\\)`));
  assert.match(migration, /club_member_import_package_mappings','source_package/);
});

test("legacy reviews preserve source evidence and are explicitly non-operational", () => {
  for (const field of ["source_membership_reference", "home_location_id", "joining_fee_waived", "promotion_label", "billing_interval", "historic_package_wording", "verified_recurring_amount_minor", "household_reference", "responsible_payer_customer_id"]) assert.match(migration, new RegExp(field));
  assert.match(migration, /members\.import/);
  assert.match(migration, /Only completed historical imports can be reviewed/);
  assert.match(migration, /arrangement_kind in \('family','couple'\)/);
  assert.match(migration, /source_member_reference=coalesce\(v_review_ref,v_source_ref\) and customer_id=r\.imported_customer_id/);
  assert.match(migration, /shared family\/couple review requires one mapped responsible payer reference/);
  assert.match(migration, /Responsible payer source row does not belong to this verified household reference/);
  assert.match(migration, /operational_effect','review_only_no_membership_no_billing_no_access/);
  assert.doesNotMatch(migration, /delete from public\.club_customers|update public\.club_customers|delete from public\.club_memberships|update public\.club_memberships|insert into public\.club_entitlement_grants/);
  assert.doesNotMatch(migration, /insert into public\.club_member_import_package_mappings|update public\.club_member_import_package_mappings/);
});
