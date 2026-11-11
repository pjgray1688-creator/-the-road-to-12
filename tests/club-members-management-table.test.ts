import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clubDirectoryPageCount, clubMembershipStatusMatches, compareClubMemberDirectoryRows, matchesClubMemberDirectoryFilters, type ClubDirectoryRow } from "../lib/club-member-directory";

const page = readFileSync("app/club/members/page.tsx", "utf8");
const directory = readFileSync("components/club-members-directory.tsx", "utf8");
const memberSummarySql = readFileSync("supabase/migrations/2026-12-17-madhouse-membership-only-directory.sql", "utf8");
const base: ClubDirectoryRow = { displayName: "Aimee Trainer", email: "aimee@example.test", phone: "07123456789", ref: "AB12CD34", plan: "Monthly", status: "active", endsAt: "2027-04-01", homeId: "rotherham", homeName: "Rotherham", userId: "user-a", accessState: "active", imported: false };

test("directory membership filters distinguish active, pending, paused, cancelled and expired records", () => {
  for (const status of ["active", "pending", "paused", "suspended", "cancelled", "expired"]) assert.equal(clubMembershipStatusMatches(status, status), true);
  assert.equal(clubMembershipStatusMatches("paused", "inactive"), true);
  assert.equal(clubMembershipStatusMatches("suspended", "inactive"), true);
  assert.equal(clubMembershipStatusMatches("cancelled", "inactive"), false);
  assert.equal(clubMembershipStatusMatches("expired", "all"), true);
});

test("arrears filter only marks users present in the authorised authoritative billing-attention result", () => {
  const usersWithArrears = new Set(["user-a"]);
  assert.equal(clubMembershipStatusMatches("active", "arrears", "user-a", usersWithArrears), true);
  assert.equal(clubMembershipStatusMatches("active", "arrears", "user-b", usersWithArrears), false);
  assert.equal(clubMembershipStatusMatches("active", "arrears", undefined, usersWithArrears), false);
  assert.match(page, /club_list_membership_billing_attention/);
  assert.match(page, /\["failed", "grace", "overdue", "retry_scheduled"\]/);
});

test("search includes email, phone and record reference, with home and plan filters", () => {
  const filters = { query: "07123", status: "all", access: "all", home: "all", plan: "all", arrearsUserIds: new Set<string>() };
  assert.equal(matchesClubMemberDirectoryFilters(base, filters), true);
  assert.equal(matchesClubMemberDirectoryFilters(base, { ...filters, query: "ab12cd34" }), true);
  assert.equal(matchesClubMemberDirectoryFilters(base, { ...filters, query: "example.test" }), true);
  assert.equal(matchesClubMemberDirectoryFilters(base, { ...filters, home: "carlton" }), false);
  assert.equal(matchesClubMemberDirectoryFilters(base, { ...filters, plan: "Off-Peak" }), false);
});

test("directory supports stable sortable fields and bounded pagination calculations", () => {
  const other = { ...base, displayName: "Bea Member", homeName: "Carlton" };
  assert.ok(compareClubMemberDirectoryRows(base, other, "name", "asc") < 0);
  assert.ok(compareClubMemberDirectoryRows(base, other, "home", "desc") < 0);
  assert.equal(clubDirectoryPageCount(0, 25), 1);
  assert.equal(clubDirectoryPageCount(51, 25), 3);
  assert.equal(clubDirectoryPageCount(51, 0), 51);
});

test("members page retains membership-only source, detail navigation and current R12 billing boundaries", () => {
  assert.match(page, /listMemberSummaries\(context\.organisation\.id\)/);
  assert.match(page, /club_list_unlinked_membership_customers/);
  assert.match(directory, /Last attendance is not included in the directory data/);
  assert.match(directory, /No open arrears/);
  assert.match(directory, /returnTo/);
  assert.match(memberSummarySql, /exists\([\s\S]*from public\.club_memberships[\s\S]*club_membership_holders/);
  assert.match(memberSummarySql, /club_list_unlinked_membership_customers/);
  assert.doesNotMatch(memberSummarySql, /club_staff_location_access/);
});
