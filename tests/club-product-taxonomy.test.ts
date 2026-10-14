import assert from "node:assert/strict";
import test from "node:test";
import { effectiveMemberShopCategory, FEATURED_MEMBER_BRANDS, featuredMemberBrandId, filterMemberShopProducts, inferMemberShopCategory, MEMBER_SHOP_CATEGORIES, sortMemberShopProducts } from "../lib/club-product-taxonomy";
import type { ClubCommerceProduct } from "../lib/club-commerce";

const product = (id: string, name: string): ClubCommerceProduct => ({ id, organisationId: "org", name, active: true, stockTracked: true, sellPriceMinor: 100, currency: "GBP", createdAt: "", updatedAt: "" });

test("member category buttons use the required eight-category order", () => {
  assert.deepEqual(MEMBER_SHOP_CATEGORIES, ["Services", "Apparel", "Deals", "Protein", "Performance", "Health & Wellness", "Weight Management", "Food, Snacks & Accessories"]);
});

test("presentation mapping classifies representative products without changing catalogue values", () => {
  assert.equal(inferMemberShopCategory({ name: "PT Session", isServiceProduct: true }), "Services");
  assert.equal(inferMemberShopCategory({ name: "R12 Gym Hoodie", category: "Merch & Apparel" }), "Apparel");
  assert.equal(inferMemberShopCategory({ name: "Whey Protein Powder", supplierCategory: "Protein" }), "Protein");
  assert.equal(inferMemberShopCategory({ name: "Ready to drink protein shake", format: "bottle" }), "Protein");
  assert.equal(inferMemberShopCategory({ name: "Creatine Monohydrate" }), "Performance");
  assert.equal(inferMemberShopCategory({ name: "Joint Support Vitamin D3" }), "Health & Wellness");
  assert.equal(inferMemberShopCategory({ name: "Animal Cuts Fat Burner" }), "Weight Management");
  assert.equal(inferMemberShopCategory({ name: "Protein Bar", category: "Supplements" }), "Food, Snacks & Accessories");
  assert.equal(inferMemberShopCategory({ name: "Cream of Rice" }), "Food, Snacks & Accessories");
  assert.equal(inferMemberShopCategory({ name: "GSN Chicken Meal" }), "Food, Snacks & Accessories");
});

test("a deliberate canonical category override wins without changing inferred metadata", () => {
  const input = { name: "Whey Protein Powder", supplierCategory: "Protein" };
  assert.equal(inferMemberShopCategory(input), "Protein");
  assert.equal(effectiveMemberShopCategory(input, "Food, Snacks & Accessories"), "Food, Snacks & Accessories");
  assert.equal(effectiveMemberShopCategory(input, "not-a-category"), "Protein");
});

test("featured-brand matching safely groups existing naming variants", () => {
  assert.deepEqual(FEATURED_MEMBER_BRANDS.map(brand => brand.label), ["Applied Nutrition", "Dorian Yates", "Scitec Nutrition", "Reflex Nutrition", "Black Mamba", "CNP Professional"]);
  assert.equal(featuredMemberBrandId("Dorian Yates - DY Nutrition - Shadow Line"), "dorian-yates");
  assert.equal(featuredMemberBrandId("DY Nutrition"), "dorian-yates");
  assert.equal(featuredMemberBrandId("Scitec"), "scitec-nutrition");
  assert.equal(featuredMemberBrandId("Reflex"), "reflex-nutrition");
  assert.equal(featuredMemberBrandId("Black Mamba Reaper"), "black-mamba");
  assert.equal(featuredMemberBrandId("CNP"), "cnp-professional");
  assert.equal(featuredMemberBrandId("Unknown Brand"), undefined);
});

test("category, featured brand, search and deals filters compose and can reset to all", () => {
  const products = [
    { ...product("whey", "Impact Whey Chocolate"), brand: "Reflex Nutrition", category: "Protein" },
    { ...product("creatine", "Creatine Monohydrate"), brand: "Reflex", category: "Supplements" },
    { ...product("bar", "Protein Bar"), brand: "Applied Nutrition", category: "Food" },
  ];
  const filters = { category: "Protein", brand: "reflex-nutrition" as const, query: "chocolate", dealProductIds: new Set<string>() };
  assert.deepEqual(filterMemberShopProducts(products, filters).map(item => item.id), ["whey"]);
  assert.deepEqual(filterMemberShopProducts(products, { ...filters, category: "Deals", dealProductIds: new Set(["bar"]) }).map(item => item.id), []);
  assert.deepEqual(filterMemberShopProducts(products, { category: "Deals", brand: "", query: "protein", dealProductIds: new Set(["bar"]) }).map(item => item.id), ["bar"]);
  assert.deepEqual(filterMemberShopProducts(products, { category: "All", brand: "", query: "", dealProductIds: new Set() }).map(item => item.id), products.map(item => item.id));
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
