import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { uniqueMemberEntitlements } from "../lib/club-member-entitlement-view";

const read = (path: string) => readFileSync(path, "utf8");

test("member profile hides repeated gym grant rows and collapses identical benefit labels", () => {
  const rows = uniqueMemberEntitlements([
    { id: "gym-1", entitlementKey: "gym_access", scope: "locations", locationIds: ["rotherham"] },
    { id: "gym-2", entitlementKey: "gym_access", scope: "locations", locationIds: ["carlton"] },
    { id: "class-1", entitlementKey: "class_credit", scope: "organisation", allowance: { quantity: 4, period: "month" } },
    { id: "class-2", entitlementKey: "class_credit", scope: "organisation", allowance: { quantity: 4, period: "month" } },
    { id: "discount-1", entitlementKey: "shop_discount", scope: "organisation", discount: { percent: 10 } },
  ]);

  assert.deepEqual(rows.map(row => row.id), ["class-1", "discount-1"]);
});

test("member profile keeps management and cash controls on the current membership only", () => {
  const layout = read("components/club-member-profile-layout.tsx");
  const history = layout.slice(layout.indexOf("Membership history"), layout.indexOf("PAYMENTS &amp; PURCHASES"));
  assert.match(layout, /currentDetail && customerId \? <ClubMembershipManager/);
  assert.match(layout, /canRecordCash=\{canRecordCashForCurrent\}/);
  assert.match(layout, /current\?\.status === "active" && currentDetail && !currentDetail\.is_lifetime/);
  assert.doesNotMatch(history, /ClubMembershipManager|Record cash payment|ClubMembershipAccessStatus/);
  assert.doesNotMatch(layout, /Manage membership<\/strong>/);
});

test("member profile layout keeps mobile columns fluid without fixed minimum viewport widths", () => {
  const styles = read("components/club-member-profile-layout.module.css");
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.doesNotMatch(styles, /min-width:\s*(?:320|375|390|430)px/);
});

test("overview presents one operational section and a single Shift Actions destination group", () => {
  const page = read("app/club/page.tsx");
  const sectionStart = page.indexOf('<section className={overviewStyles.desktopOverview}');
  const overview = page.slice(sectionStart);
  assert.equal((overview.match(/Shift actions/gi) ?? []).length, 1);
  assert.doesNotMatch(overview, /Quick access|Needs attention<\/h3>/);
  for (const action of ["My Shift", "Members", "Till", "Timetable", "Daily Checks"]) {
    assert.ok(overview.includes(`>${action} <span`), `missing ${action} shift action`);
  }
});
