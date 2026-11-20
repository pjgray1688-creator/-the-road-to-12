import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatClubDate, membershipPaidThroughDate, membershipPaidThroughDateInput } from "@/lib/club-date-display";
import { matchesClubMemberDirectoryFilters, type ClubDirectoryRow } from "@/lib/club-member-directory";
import { memberClassDisplayTitle } from "@/lib/member-class-presentation";
import { uniqueMembershipOrganisationRows } from "@/lib/member-hub-view";

const baseFilters = { query: "", status: "all", access: "all", home: "all", plan: "all", arrearsUserIds: new Set<string>() };

test("Member Hub renders one dashboard per organisation even when several memberships are returned", () => {
  const rows = [
    { id: "membership-a", organisation: { id: "gym-a" } },
    { id: "membership-b", organisation: { id: "gym-a" } },
    { id: "membership-c", organisation: { id: "gym-b" } },
    { id: "bad", organisation: null },
  ];
  assert.deepEqual(uniqueMembershipOrganisationRows(rows).map(row => row.id), ["membership-a", "membership-c"]);
});

test("Club membership dates show the paid-through day before the London-midnight expiry boundary", () => {
  assert.equal(membershipPaidThroughDate("2026-11-20T00:00:00.000Z"), "19 Nov 2026");
  assert.equal(membershipPaidThroughDate("2026-03-30T23:00:00.000Z"), "30 Mar 2026");
  assert.equal(membershipPaidThroughDate("2026-10-25T23:00:00.000Z"), "25 Oct 2026");
  assert.equal(membershipPaidThroughDateInput("2026-03-30T23:00:00.000Z"), "2026-03-30");
  assert.equal(formatClubDate("2026-11-20"), "20 Nov 2026");
});

test("Member search matches accented names, references and phone digits", () => {
  const row: ClubDirectoryRow = { displayName: "José O’Neil", email: "jose@example.test", phone: "+44 7700 900123", ref: "MAD12345", imported: false };
  assert.equal(matchesClubMemberDirectoryFilters(row, { ...baseFilters, query: "jose oneil" }), true);
  assert.equal(matchesClubMemberDirectoryFilters(row, { ...baseFilters, query: "MAD12345" }), true);
  assert.equal(matchesClubMemberDirectoryFilters(row, { ...baseFilters, query: "900123" }), true);
});

test("legacy Women Only session title is presented as Girls and Gains without changing eligibility", () => {
  assert.equal(memberClassDisplayTitle("Women Only", "Girls and Gains"), "Girls and Gains");
  assert.equal(memberClassDisplayTitle("Women Only", "BoxFit"), "Women Only");
  assert.equal(memberClassDisplayTitle(undefined, "Girls and Gains"), "Girls and Gains");
});

test("Member Shop and training presentation regressions remain covered in their render paths", () => {
  const hub = readFileSync("components/member-hub.tsx", "utf8");
  const shop = readFileSync("components/club-shop.tsx", "utf8");
  const trainingSetup = readFileSync("components/training-setup-choice.tsx", "utf8");
  const trainingPage = readFileSync("app/training/page.tsx", "utf8");
  const preview = readFileSync("app/training/preview/preview-client.tsx", "utf8");
  const styles = readFileSync("app/globals.css", "utf8");
  assert.match(hub, /Open Member Shop/);
  assert.doesNotMatch(hub, /Open Member Shop<\/strong><small>/);
  assert.match(shop, /item\.productName\} ×\$\{item\.quantity/);
  assert.doesNotMatch(trainingSetup, /BackButton href="\/training"/);
  assert.doesNotMatch(trainingPage, /PROGRAMME TOOLS/);
  assert.doesNotMatch(preview, /Back to Training/);
  assert.match(styles, /\.member-area-page \.member-class-list/);
  assert.match(styles, /\.club-card-pagination\{display:flex/);
});
