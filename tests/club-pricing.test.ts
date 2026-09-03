import assert from "node:assert/strict";
import test from "node:test";
import { exVatToInclVatMinor, grossUpForMerchantFeeMinor, inclVatToExVatMinor, pricingMath, recommendedPriceMinor } from "../lib/club-pricing";

test("pricing math keeps markup and margin distinct", () => {
  const result = pricingMath(1000, 1500);
  assert.equal(result?.profitMinor, 500);
  assert.equal(result?.markupPercent, 50);
  assert.equal(result?.marginPercent, 33.33333333333333);
  assert.equal(result?.profitAfterFeeMinor, 500);
});

test("merchant fee gross-up uses division by the retained rate", () => {
  assert.equal(grossUpForMerchantFeeMinor(1000, 2), 1021);
  assert.equal(pricingMath(500, 1021, 0, 2)?.netRevenueMinor, 1001);
  assert.equal(grossUpForMerchantFeeMinor(1000, 100), undefined);
});

test("VAT conversion is deterministic in minor units", () => {
  assert.equal(inclVatToExVatMinor(1200, 20), 1000);
  assert.equal(exVatToInclVatMinor(1000, 20), 1200);
  assert.equal(inclVatToExVatMinor(1000, 0), 1000);
});

test("recommended prices support explicit target and rounding", () => {
  assert.equal(recommendedPriceMinor(1000, { kind: "markup", percent: 50 }), 1500);
  assert.equal(recommendedPriceMinor(1000, { kind: "margin", percent: 30 }, "10p"), 1430);
});
