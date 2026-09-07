import assert from "node:assert/strict";
import test from "node:test";
import { effectiveMemberShopCategory, inferMemberShopCategory, sortMemberShopProducts } from "../lib/club-product-taxonomy";
import type { ClubCommerceProduct } from "../lib/club-commerce";

const product = (id: string, name: string): ClubCommerceProduct => ({ id, organisationId: "org", name, active: true, stockTracked: true, sellPriceMinor: 100, currency: "GBP", createdAt: "", updatedAt: "" });

test("category inference distinguishes ready-to-consume food from prepared supplements", () => {
  assert.equal(inferMemberShopCategory({ name: "Ready to drink protein shake", format: "bottle" }), "Food & Drinks");
  assert.equal(inferMemberShopCategory({ name: "Whey Protein Powder", supplierCategory: "Protein" }), "Supplements");
  assert.equal(inferMemberShopCategory({ name: "Creatine Monohydrate" }), "Supplements");
  assert.equal(inferMemberShopCategory({ name: "Cream of Rice" }), "Supplements");
  assert.equal(inferMemberShopCategory({ name: "GSN Chicken Meal" }), "Food & Drinks");
  assert.equal(inferMemberShopCategory({ name: "Gym Hoodie" }), "Merch & Apparel");
});

test("a deliberate canonical category override wins without changing inferred metadata", () => {
  const input = { name: "Whey Protein Powder", supplierCategory: "Protein" };
  assert.equal(inferMemberShopCategory(input), "Supplements");
  assert.equal(effectiveMemberShopCategory(input, "Food & Drinks"), "Food & Drinks");
  assert.equal(effectiveMemberShopCategory(input, "not-a-category"), "Supplements");
});

test("member catalogue ranks local stock before supplier-only and unavailable products", () => {
  const products = [product("supplier", "Whey"), product("none", "Water"), product("local", "Creatine")];
  const sorted = sortMemberShopProducts(products, { local: { localAvailable: true }, supplier: { supplierAvailable: true }, none: {} });
  assert.deepEqual(sorted.map(item => item.id), ["local", "supplier", "none"]);
});

test("search relevance takes precedence while availability remains the tie-breaker", () => {
  const products = [product("local", "Protein Bar"), product("supplier", "Protein Powder"), product("other", "Creatine")];
  const sorted = sortMemberShopProducts(products, { local: { localAvailable: true }, supplier: { supplierAvailable: true } }, "powder");
  assert.equal(sorted[0].id, "supplier");
});
