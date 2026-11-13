import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { comparePeriodValues, parseClubFinanceMemberCounts, parseGlowZoneFinanceReport } from "../lib/glow-zone-finance";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Glow Zone finance reporting uses an organisation and capability guarded projection", async () => {
  const [page, migration] = await Promise.all([
    read("app/club/payments/page.tsx"),
    read("supabase/migrations/2026-11-13-club-glow-finance-report-rpc.sql"),
  ]);
  assert.match(page, /client\.rpc\("club_list_glow_finance_report"/);
  assert.doesNotMatch(page, /from\("club_glow_sales"\)/);
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'finance\.view'\)/);
  assert.match(migration, /s\.organisation_id=p_organisation_id/);
  assert.match(migration, /s\.status='completed'/);
  assert.match(migration, /p_location_id is null or s\.location_id=p_location_id/);
  assert.match(migration, /revoke all on function public\.club_list_glow_finance_report[^;]+ from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.club_list_glow_finance_report[^;]+ to authenticated/);
  assert.doesNotMatch(migration, /to_jsonb\(s\)|select \* from public\.club_glow_sales/i);
  const manifest = await read("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt");
  assert.ok(manifest.indexOf("club-glow-management-report-rpc.sql") < manifest.indexOf("club-glow-finance-report-rpc.sql"));
});

test("finance warning identifies incomplete consolidated sales without suppressing diagnostics", async () => {
  const page = await read("app/club/payments/page.tsx");
  assert.match(page, /R12_FINANCE_READ_FAILED/);
  assert.match(page, /Total business income/);
  assert.match(page, /Franchise \/ membership income/);
  assert.match(page, /Total business income\", value: \"Incomplete\"/);
  assert.match(page, /Financial report is incomplete/);
  assert.match(page, /Glow Zone sales · Products &amp; Services/);
  assert.match(page, /club_finance_member_counts_secure/);
  assert.match(page, /Previous equivalent period/);
});

test("missing and contradictory Glow report payloads are not converted into zero revenue", () => {
  assert.equal(parseGlowZoneFinanceReport(null), undefined);
  assert.equal(parseGlowZoneFinanceReport({ records: [], total_minor: 0, completed_count: 0, minutes_sold: 0 })?.total_minor, 0);
  assert.equal(parseGlowZoneFinanceReport({ records: [], total_minor: 100, completed_count: 0, minutes_sold: 0 }), undefined);
  assert.equal(parseGlowZoneFinanceReport({ records: [{ status: "pending", amount_minor: 100, minutes: 5, location_id: "carlton", created_at: "2026-11-12T12:00:00Z" }], total_minor: 100, completed_count: 1, minutes_sold: 5 }), undefined);
});

test("active member counts require a valid secure projection and retain unassigned members", async () => {
  const counts = parseClubFinanceMemberCounts({
    as_of: "2026-11-13T12:00:00Z", active_members: 12, unassigned_members: 1, conflicting_home_locations: 1,
    locations: [{ id: "r", name: "Madhouse Rotherham", active_members: 6 }, { id: "c", name: "Madhouse Carlton", active_members: 4 }],
  });
  assert.equal(counts?.activeMembers, 12);
  assert.equal(counts?.unassignedMembers, 1);
  assert.equal(counts?.conflictingHomeLocations, 1);
  assert.equal(counts?.locations[1]?.activeMembers, 4);
  assert.equal(parseClubFinanceMemberCounts({ active_members: 0, unassigned_members: 0, conflicting_home_locations: 0, locations: [] }), undefined);
  const migration = await read("supabase/migrations/2026-11-13-club-finance-member-counts-rpc.sql");
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'finance\.view'\)/);
  assert.match(migration, /membership\.status='active'/);
  assert.match(migration, /product\.kind='membership'/);
  assert.match(migration, /'conflicting_home_locations'/);
  assert.match(migration, /home_location_state/);
  assert.match(migration, /coalesce\(member\.preferred_location_id,c\.preferred_location_id\)/);
  assert.match(migration, /revoke all on function public\.club_finance_member_counts_secure\(uuid\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.club_finance_member_counts_secure\(uuid\) to authenticated/);
  const manifest = await read("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt");
  assert.ok(manifest.indexOf("club-glow-finance-report-rpc.sql") < manifest.indexOf("club-finance-member-counts-rpc.sql"));
});

test("period changes avoid fabricated percentages for a zero baseline", () => {
  assert.deepEqual(comparePeriodValues(120, 100), { difference: 20, percentage: 20, direction: "up" });
  assert.deepEqual(comparePeriodValues(0, 0), { difference: 0, percentage: undefined, direction: "flat" });
  assert.equal(comparePeriodValues(Number.NaN, 10), undefined);
});

test("management finance destinations do not link to a nonexistent order route", async () => {
  const page = await read("app/club/more/page.tsx");
  assert.match(page, /Checkout attempts/);
  assert.match(page, /\/club\/payments\?org=.*view=attempts/);
  assert.doesNotMatch(page, /href: `\/club\/orders/);
  assert.match(page, /Cash close & verification/);
  assert.match(page, /Cash approvals/);
  assert.match(page, /Physical cash collections/);
  assert.match(page, /Till history & refunds/);
  const repeatedPaymentsTarget = [...page.matchAll(/href: `\/club\/payments\$\{q\}`/g)];
  assert.equal(repeatedPaymentsTarget.length, 1);
});

test("member profile and till log keep existing operations with less duplicated chrome", async () => {
  const [profile, till, css] = await Promise.all([
    read("app/club/members/[userId]/page.tsx"),
    read("components/club-recent-sales.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(profile, /IDENTITY &amp; CONTACT/);
  assert.doesNotMatch(profile, /R12 account linked/);
  assert.match(profile, /club-profile-back/);
  assert.match(css, /\.club-profile-back[^}]*color:#4b315e/);
  assert.doesNotMatch(till, /STAFF TILL|<h2>Till log<\/h2>/);
  assert.match(till, /aria-label="Till log"/);
  assert.match(till, /Search receipts/);
});

test("order allocation and verified email-change workflows are not represented as complete without backend support", async () => {
  const [orderRoutes, memberActions] = await Promise.all([
    read("app/club/shop/actions.ts"),
    read("app/club/members/actions.ts"),
  ]);
  assert.match(orderRoutes, /purchaseAction/);
  assert.doesNotMatch(orderRoutes, /recordExternalOrderPaymentAction/);
  assert.doesNotMatch(memberActions, /requestVerifiedMemberEmailChangeAction/);
});
