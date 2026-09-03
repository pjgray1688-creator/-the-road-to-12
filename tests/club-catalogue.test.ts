import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseMinorUnits } from "../lib/club-money";

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
