import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseMinorUnits } from "../lib/club-money";
import { normalizeBarcode } from "../lib/club-barcode";

const component = readFileSync(new URL("../components/club-catalogue.tsx", import.meta.url), "utf8");
const action = readFileSync(new URL("../app/club/shop/actions.ts", import.meta.url), "utf8");

test("catalogue management uses the authoritative owner boundary and exact GBP minor units", () => {
  assert.match(action, /saveCommerceProduct/);
  assert.match(action, /\["gym_admin", "owner"\]/);
  assert.equal(parseMinorUnits("22.00"), 2200);
  assert.equal(parseMinorUnits("15"), 1500);
  assert.equal(parseMinorUnits("10.001"), undefined);
  assert.match(component, /Barcode/);
  assert.match(component, /Physical stock tracked/);
  assert.match(component, /mediaUrl/);
});

test("catalogue preparation never creates stock movements", () => {
  assert.doesNotMatch(action.slice(action.indexOf("saveCatalogueProductAction")), /adjustInventory/);
  assert.match(component, /No retail products have been added yet/);
});

test("barcode identity preserves leading zeroes and lookup remains candidate-only", () => {
  assert.equal(normalizeBarcode(" 00505655207376 "), "00505655207376");
  assert.equal(normalizeBarcode("not-a-barcode"), undefined);
  assert.match(action, /OpenFoodFactsBarcodeProvider/);
  assert.match(action, /Couldn’t identify this product online/);
  assert.doesNotMatch(action.slice(action.indexOf("lookupBarcodeAction")), /saveCommerceProduct/);
});

test("Madhouse preparation keeps Collagen out of a false ten-pound unit price", () => {
  const csv = readFileSync(new URL("../docs/madhouse-catalogue-demo.csv", import.meta.url), "utf8");
  assert.match(csv, /Creatine Gummies,Creatine,15\.00,5056555207376/);
  assert.match(csv, /Collagen,Health & Wellness,,/);
  assert.doesNotMatch(csv, /Collagen[^\n]*10\.00/);
});
