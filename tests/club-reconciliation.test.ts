import assert from "node:assert/strict";
import test from "node:test";
import { filterCashForPeriod, reconciliationCsv, reconciliationState, summariseReconciliation } from "@/lib/club-reconciliation";

const orders = [
  { id: "sale", created_at: "2026-09-01T10:00:00Z", status: "paid", subtotal_minor: 1000, discount_minor: 100, total_minor: 900, currency: "GBP" },
  { id: "comp", created_at: "2026-09-01T11:00:00Z", status: "paid", subtotal_minor: 500, discount_minor: 500, total_minor: 0, currency: "GBP" },
  { id: "unpaid", created_at: "2026-09-01T12:00:00Z", status: "pending_payment", subtotal_minor: 700, discount_minor: 0, total_minor: 700, currency: "GBP" }
];

test("reconciliation keeps order revenue distinct from tender and identifies exceptions", () => {
  const payments = [
    { id: "cash", order_id: "sale", created_at: "2026-09-01T10:01:00Z", method: "cash", amount_minor: 900, status: "paid" },
    { id: "pending", order_id: "unpaid", created_at: "2026-09-01T12:01:00Z", method: "card", amount_minor: 700, status: "pending" }
  ];
  const summary = summariseReconciliation(orders, payments);
  assert.equal(summary.grossMinor, 2200);
  assert.equal(summary.discountMinor, 600);
  assert.equal(summary.netMinor, 1600);
  assert.equal(summary.paidMinor, 900);
  assert.equal(summary.cashMinor, 900);
  assert.equal(summary.pendingMinor, 700);
  assert.equal(summary.unpaidMinor, 700);
  assert.equal(summary.compValueMinor, 500);
  assert.equal(reconciliationState(orders[0], payments), "reconciled");
  assert.equal(reconciliationState(orders[1], payments), "comp");
  assert.equal(reconciliationState(orders[2], payments), "pending");
});

test("period cash filtering uses the confirmed declaration event and location", () => {
  const cash = [
    { status: "confirmed", declaredAt: "2026-09-01T12:00:00Z", locationId: "r", declaredAmountMinor: 100 },
    { status: "confirmed", declaredAt: "2026-08-31T23:59:00Z", locationId: "r", declaredAmountMinor: 200 },
    { status: "confirmed", declaredAt: "2026-09-01T12:00:00Z", locationId: "c", declaredAmountMinor: 300 }
  ];
  assert.equal(filterCashForPeriod(cash, new Date("2026-09-01T00:00:00Z"), new Date("2026-09-01T23:59:59Z"), "r").reduce((sum,item)=>sum+item.declaredAmountMinor,0), 100);
});

test("partial payments are not reconciled and multiple tenders are represented", () => {
  const order = { id: "o", created_at: "2026-09-01T00:00:00Z", status: "paid", subtotal_minor: 10000, discount_minor: 0, total_minor: 10000, currency: "GBP" };
  const partial = [{ id: "p1", order_id: "o", created_at: "2026-09-01T00:00:00Z", method: "balance", amount_minor: 2000, status: "paid" }];
  assert.equal(reconciliationState(order, partial), "unpaid");
  const csv = reconciliationCsv([order], [...partial, { id: "p2", order_id: "o", created_at: "2026-09-01T00:00:01Z", method: "card", amount_minor: 8000, status: "paid" }]);
  assert.match(csv, /balance \+ card/);
  assert.match(csv, /reconciled/);
});
