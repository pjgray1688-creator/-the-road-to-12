import assert from "node:assert/strict";
import test from "node:test";
import { cashDiscrepancyMinor, parseMinorUnits } from "@/lib/club-money";

test("cash amounts parse decimal pounds into exact integer minor units", () => {
  assert.equal(parseMinorUnits("10"), 1000);
  assert.equal(parseMinorUnits("10.00"), 1000);
  assert.equal(parseMinorUnits("10.50"), 1050);
  assert.equal(parseMinorUnits("0.50"), 50);
  assert.equal(parseMinorUnits("0.01"), 1);
  assert.equal(parseMinorUnits("10.001"), undefined);
  assert.equal(parseMinorUnits("-1"), undefined);
  assert.equal(parseMinorUnits("not money"), undefined);
});

test("cash discrepancy is counted minor units minus declared minor units", () => {
  assert.equal(cashDiscrepancyMinor(1000, "10.00"), 0);
  assert.equal(cashDiscrepancyMinor(1000, "9.50"), -50);
  assert.equal(cashDiscrepancyMinor(1000, "10.50"), 50);
  assert.equal(cashDiscrepancyMinor(1000, "10.001"), undefined);
});
