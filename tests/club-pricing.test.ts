import assert from "node:assert/strict";
import test from "node:test";
import { pricingMath, recommendedPriceMinor } from "../lib/club-pricing";

test("pricing math keeps markup and margin distinct", () => {
  const result = pricingMath(1000, 1500);
  assert.equal(result?.profitMinor, 500);
  assert.equal(result?.markupPercent, 50);
  assert.equal(result?.marginPercent, 33.33333333333333);
});

test("recommended prices support explicit target and rounding", () => {
  assert.equal(recommendedPriceMinor(1000, { kind: "markup", percent: 50 }), 1500);
  assert.equal(recommendedPriceMinor(1000, { kind: "margin", percent: 30 }, "10p"), 1430);
});
