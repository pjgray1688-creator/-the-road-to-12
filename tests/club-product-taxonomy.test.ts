import assert from "node:assert/strict";
import test from "node:test";
import { canonicalMemberBrandName, effectiveMemberShopCategory, FEATURED_MEMBER_BRANDS, featuredMemberBrandId, filterMemberShopProducts, inferMemberShopCategory, memberShopBrandOptions, MEMBER_SHOP_CATEGORIES, sortMemberShopProducts } from "../lib/club-product-taxonomy";
import type { ClubCommerceProduct } from "../lib/club-commerce";

const product = (id: string, name: string): ClubCommerceProduct => ({ id, organisationId: "org", name, active: true, stockTracked: true, sellPriceMinor: 100, currency: "GBP", createdAt: "", updatedAt: "" });

test("member category buttons use the required eight-category order", () => {
  assert.deepEqual(MEMBER_SHOP_CATEGORIES, ["Services", "Apparel", "Deals", "Protein", "Performance", "Health & Wellness", "Food & Drink", "Accessories"]);
});

test("presentation mapping classifies representative products without changing catalogue values", () => {
  assert.equal(inferMemberShopCategory({ name: "PT Session", isServiceProduct: true }), "Services");
  assert.equal(inferMemberShopCategory({ name: "R12 Gym Hoodie", category: "Merch & Apparel" }), "Apparel");
  assert.equal(inferMemberShopCategory({ name: "Whey Protein Powder", supplierCategory: "Protein" }), "Protein");
  assert.equal(inferMemberShopCategory({ name: "Protein Shake", format: "single bottle" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "Protein Shake", format: "12 x 330ml case" }), "Protein");
  assert.equal(inferMemberShopCategory({ name: "Creatine Monohydrate" }), "Performance");
  assert.equal(inferMemberShopCategory({ name: "Joint Support Vitamin D3" }), "Health & Wellness");
  assert.equal(inferMemberShopCategory({ name: "Animal Cuts Fat Burner" }), "Health & Wellness");
  assert.equal(inferMemberShopCategory({ name: "Protein Bar", category: "Protein" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "Protein Cookie", supplierCategory: "Protein" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "Protein Chips" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "Protein Snack" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "Novelty Item", description: "Contains protein" }), undefined);
  assert.equal(inferMemberShopCategory({ name: "Whey Protein Powder", category: "Supplements" }), "Protein");
  assert.equal(inferMemberShopCategory({ name: "Whey Isolate Tub" }), "Protein");
  assert.equal(inferMemberShopCategory({ name: "Clear Whey Powder" }), "Protein");
  assert.equal(inferMemberShopCategory({ name: "Snack Bar" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "GSN Chicken Meal" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "Monster Energy Original", format: "single can" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "R12 Shaker" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Bottle" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Training Gloves" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Knee Sleeves" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Elbow Sleeves" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Lifting Gloves" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Gym Gloves" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Lifting Hooks" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Hand Grips" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Bulk Cream of Rice Powder" }), "Performance");
  assert.equal(inferMemberShopCategory({ name: "Cream of Rice", supplierCategory: "Supplements" }), "Performance");
  assert.equal(inferMemberShopCategory({ name: "Powdered Meal Replacement", supplierCategory: "Food & Drinks" }), "Performance");
  assert.notEqual(inferMemberShopCategory({ name: "Protein Pancakes", category: "Protein" }), "Protein");
  assert.notEqual(inferMemberShopCategory({ name: "Protein Water", format: "single 500ml bottle" }), "Protein");
  assert.notEqual(inferMemberShopCategory({ name: "Protein RTD Shake", format: "individual bottle" }), "Protein");
  assert.equal(inferMemberShopCategory({ name: "Whey Protein Powder Tub", category: "Supplements" }), "Protein");
  assert.equal(inferMemberShopCategory({ name: "Whey Protein Sachets", format: "powder sachets" }), "Protein");
  assert.equal(inferMemberShopCategory({ name: "Protein Shake", format: "12 x 330ml case" }), "Protein");
  assert.equal(inferMemberShopCategory({ name: "GSN Greek Souvlaki Chicken Wrap" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "GSN Chicken Meal" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "Canned Energy Drink", format: "single 250ml can" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "Lion's Mane" }), "Health & Wellness");
  assert.equal(inferMemberShopCategory({ name: "AAKG" }), "Performance");
  assert.equal(inferMemberShopCategory({ name: "Pre-Workout" }), "Performance");
  assert.equal(inferMemberShopCategory({ name: "L-Carnitine Supplement" }), "Health & Wellness");
  assert.notEqual(inferMemberShopCategory({ name: "GSN Sticky BBQ Chicken Wrap" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Wrist Wraps" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Knee Wraps" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Gym Shaker" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Water Jug" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Alpha Bottle Jug 1600ml" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Alpha Bottle Shaker V2" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Alpha Pod" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Gallon Jug" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Knee Sleeves" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Lifting Straps" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Lifting Belt" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Smelling Salts" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Tacky Remover" }), "Accessories");
  assert.notEqual(inferMemberShopCategory({ name: "GSN Aromatic Salt & Pepper Wrap" }), "Accessories");
  assert.equal(inferMemberShopCategory({ name: "Protein Powder Tub" }), "Protein");
  assert.notEqual(inferMemberShopCategory({ name: "Protein Powder Tub" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "Applied Nutrition Protein Wafer Bar" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "Ready To Drink Protein Shake", format: "330ml bottle" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "Carb Killa Bar in a Jar Spread", supplierCategory: "Drinks and Bars" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "Oats", supplierCategory: "Food" }), "Food & Drink");
  assert.equal(inferMemberShopCategory({ name: "Creatine Powder", supplierCategory: "Food" }), "Performance");
  assert.equal(inferMemberShopCategory({ name: "Vitamin D3 Tablets", supplierCategory: "Food" }), "Health & Wellness");
  assert.equal(inferMemberShopCategory({ name: "Unknown Supplement" }), undefined);
});

test("a deliberate canonical category override wins without changing inferred metadata", () => {
  const input = { name: "Whey Protein Powder", supplierCategory: "Protein" };
  assert.equal(inferMemberShopCategory(input), "Protein");
  assert.equal(effectiveMemberShopCategory(input, "Accessories"), "Accessories");
  assert.equal(effectiveMemberShopCategory(input, "not-a-category"), "Protein");
});

test("explicit category regression fixture keeps accessories, foods and supplements separated", () => {
  const fixture = [
    { name: "PT Session", isServiceProduct: true },
    { name: "R12 Hoodie" },
    { name: "Deal Whey Tub", category: "Deals" },
    { name: "Whey Protein Powder Tub" },
    { name: "Protein Shake Case", format: "12 x 330ml case" },
    { name: "Creatine Monohydrate" },
    { name: "Cream of Rice Powder" },
    { name: "Vitamin D3" },
    { name: "Fat Burner" },
    { name: "GSN Chicken Wrap" },
    { name: "Energy Drink Single Can" },
    { name: "Shaker" },
    { name: "Alpha Bottle Jug 1600ml" },
    { name: "Unknown Supplier Item" },
  ];
  const counts = fixture.reduce<Record<string, number>>((result, item) => {
    const category = inferMemberShopCategory(item);
    if (category) result[category] = (result[category] ?? 0) + 1;
    return result;
  }, {});
  assert.deepEqual(counts, { Services: 1, Apparel: 1, Deals: 1, Protein: 2, Performance: 2, "Health & Wellness": 2, "Food & Drink": 2, Accessories: 2 });
  assert.equal(inferMemberShopCategory({ name: "Alpha Bottle Jug 1600ml" }), "Accessories");
  const unknown = product("unknown", "Unknown Supplier Item");
  assert.deepEqual(filterMemberShopProducts([unknown], { category: "All", brand: "", query: "", dealProductIds: new Set() }), [unknown]);
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

test("Grenade legacy brand is canonicalized once for options and product filtering", () => {
  const products = [
    { ...product("bar-new", "Carb Killa Protein Bar Chocolate"), brand: "Grenade" },
    { ...product("bar-old", "Carb Killa Protein Bar Chocolate"), brand: "Grenade - Carb Killa Bars" },
    { ...product("bar-old-case", "Carb Killa Protein Bar Birthday Cake"), brand: "GRENADE - CARB KILLA BARS" },
    { ...product("bar-old-punctuation", "Carb Killa Protein Bar White Chocolate"), brand: "Grenade / Carb-Killa Bars" },
  ];
  assert.equal(canonicalMemberBrandName("Grenade - Carb Killa Bars"), "Grenade");
  assert.equal(canonicalMemberBrandName("GRENADE - CARB KILLA BARS"), "Grenade");
  assert.equal(canonicalMemberBrandName("Grenade / Carb-Killa Bars"), "Grenade");
  assert.deepEqual(memberShopBrandOptions(products.map(item => item.brand)), ["Grenade"]);
  assert.deepEqual(filterMemberShopProducts(products, { category: "All", brand: "Grenade", query: "", dealProductIds: new Set() }).map(item => item.id), ["bar-new", "bar-old", "bar-old-case", "bar-old-punctuation"]);
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
