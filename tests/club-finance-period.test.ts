import assert from "node:assert/strict";
import test from "node:test";
import { collectibleMembershipOutstanding, filterCashAwaitingVerification } from "@/lib/club-reconciliation";
import { londonDateKey, londonMidnightUtc, resolveClubFinancePeriod } from "@/lib/club-finance-period";

test("finance date boundaries follow Europe/London through winter and British Summer Time", () => {
  assert.equal(londonMidnightUtc("2026-01-12").toISOString(), "2026-01-12T00:00:00.000Z");
  assert.equal(londonMidnightUtc("2026-07-12").toISOString(), "2026-07-11T23:00:00.000Z");
  assert.equal(londonDateKey("2026-07-11T23:30:00.000Z"), "2026-07-12");
  const period = resolveClubFinancePeriod({ preset: "7d" }, new Date("2026-07-12T12:00:00Z"));
  assert.equal(period.fromKey, "2026-07-06");
  assert.equal(period.toKey, "2026-07-12");
  assert.equal(period.from.toISOString(), "2026-07-05T23:00:00.000Z");
  assert.equal(period.to.toISOString(), "2026-07-12T22:59:59.999Z");
});

test("custom finance periods are inclusive and reorder reversed dates", () => {
  const period = resolveClubFinancePeriod({ preset: "custom", from: "2026-10-03", to: "2026-10-01" }, new Date("2026-10-23T12:00:00Z"));
  assert.equal(period.fromKey, "2026-10-01");
  assert.equal(period.toKey, "2026-10-03");
  assert.equal(period.to.toISOString(), "2026-10-03T22:59:59.999Z");
});

test("cash-to-verify only includes declared cash in selected period and venue", () => {
  const rows = [
    { id: "due", status: "declared", declaredAt: "2026-10-20T12:00:00Z", locationId: "r", declaredAmountMinor: 1000 },
    { id: "verified", status: "confirmed", declaredAt: "2026-10-20T12:00:00Z", locationId: "r", declaredAmountMinor: 2000 },
    { id: "other-site", status: "declared", declaredAt: "2026-10-20T12:00:00Z", locationId: "c", declaredAmountMinor: 3000 },
  ];
  const result = filterCashAwaitingVerification(rows, new Date("2026-10-20T00:00:00Z"), new Date("2026-10-20T23:59:59Z"), "r");
  assert.deepEqual(result.map(row => row.id), ["due"]);
});

test("outstanding deduplicates collectible membership dues and excludes future or terminal states", () => {
  const rows = [
    { id: "due", state: "overdue", next_due_at: "2026-10-20T00:00:00Z", amount_minor: 4000 },
    { id: "due", state: "retry_scheduled", next_due_at: "2026-10-20T00:00:00Z", amount_minor: 4000 },
    { id: "future", state: "due", next_due_at: "2026-10-24T00:00:00Z", amount_minor: 2000 },
    { id: "paid", state: "paid", next_due_at: "2026-10-20T00:00:00Z", amount_minor: 7000 },
    { id: "cancelled", state: "cancelled", next_due_at: "2026-10-20T00:00:00Z", amount_minor: 5000 },
  ];
  assert.equal(collectibleMembershipOutstanding(rows, new Date("2026-10-23T00:00:00Z")), 4000);
});
