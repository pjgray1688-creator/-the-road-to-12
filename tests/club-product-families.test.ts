import test from "node:test";
import assert from "node:assert/strict";
import { availableVariantOptions, groupProductFamilies, memberVariantChoices, resolveProductVariant } from "../lib/club-product-families";
import type { ClubCommerceProduct } from "../lib/club-commerce";

const product = (id: string, options: Record<string,string>, price = 1000, active = true): ClubCommerceProduct => ({ id, organisationId: "org", name: "Beef XP", active, stockTracked: true, sellPriceMinor: price, currency: "GBP", variantOptions: options, createdAt: "", updatedAt: "", familyId: "fam" });
const variants = [product("a", { Size: "1.8kg", Flavour: "Chocolate" }, 2000), product("b", { Size: "1.8kg", Flavour: "Banana" }, 2200), product("c", { Size: "2.7kg", Flavour: "Chocolate" }, 3000), product("x", { Size: "2.7kg", Flavour: "Unavailable" }, 3000, false)];

test("families group variants and preserve ungrouped products", () => {
  const cards = groupProductFamilies([...variants, { ...product("u", {}, 500), familyId: undefined, name: "Water" }], [{ id: "fam", organisationId: "org", name: "Applied Nutrition — Beef XP", active: true, sortPosition: 0 }], "org");
  assert.equal(cards.length, 2); assert.equal(cards[0].variants.length, 3); assert.equal(cards[0].priceLabel, "From £20.00"); assert.equal(cards[1].label, "Water");
});
test("options are derived only from real active combinations", () => {
  assert.deepEqual(availableVariantOptions(variants), { Flavour: ["Banana", "Chocolate"], Size: ["1.8kg", "2.7kg"] });
  assert.deepEqual(availableVariantOptions(variants, { Size: "2.7kg" }), { Flavour: ["Chocolate"], Size: ["2.7kg"] });
  assert.equal(resolveProductVariant(variants, { Size: "2.7kg", Flavour: "Chocolate" })?.id, "c");
  assert.equal(resolveProductVariant(variants, { Size: "2.7kg", Flavour: "Banana" }), undefined);
});
test("organisation and inactive variants are excluded", () => {
  assert.equal(groupProductFamilies([product("other", {}, 1)], [], "org").length, 1);
  assert.equal(groupProductFamilies([product("other", {}, 1)], [], "different").length, 0);
});

test("legacy and canonical Carb Killa parents collapse into one Grenade family and duplicate products show once", () => {
  const products = [
    { ...product("bar-current", { Flavour: "Chocolate" }), name: "Carb Killa Protein Bar", brand: "Grenade", familyId: "grenade-current" },
    { ...product("bar-legacy", { Flavour: "Chocolate" }), name: "Carb Killa Protein Bar", brand: "Grenade - Carb Killa Bars", familyId: "grenade-legacy" },
    { ...product("bar-birthday", { Flavour: "Birthday Cake" }), name: "Carb Killa Protein Bar", brand: "Grenade - Carb Killa Bars", familyId: "grenade-legacy" },
  ];
  const families = [
    { id: "grenade-current", organisationId: "org", name: "Carb Killa Bars", brand: "Grenade", active: true, sortPosition: 0 },
    { id: "grenade-legacy", organisationId: "org", name: "Carb Killa Bars", brand: "Grenade - Carb Killa Bars", active: true, sortPosition: 1 },
  ];
  const cards = groupProductFamilies(products, families, "org");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].family?.brand, "Grenade");
  assert.equal(cards[0].variants.length, 2);
  assert.deepEqual(availableVariantOptions(cards[0].variants), { Flavour: ["Birthday Cake", "Chocolate"] });
});

test("Carb Killa variants merge only within the same product family, not across formats", () => {
  const products = [
    { ...product("bar-canonical", { Flavour: "Chocolate" }), name: "Carb Killa Protein Bar", brand: "Grenade", familyId: "bars-new" },
    { ...product("bar-legacy", { Flavour: "Birthday Cake" }), name: "Carb Killa Protein Bar", brand: "GRENADE - CARB KILLA BARS", familyId: "bars-legacy" },
    { ...product("spread", { Size: "360g" }), name: "Carb Killa Bar in a Jar Spread", brand: "Grenade - Carb Killa Bars", familyId: "spread" },
    { ...product("rtd", { Size: "8 x 330ml" }), name: "Carb Killa Shake RTD", brand: "Grenade", familyId: "rtd" },
    { ...product("soft-core", { Flavour: "Creme Egg" }), name: "Soft Core Creme Egg Protein Bar", brand: "Grenade - Carb Killa Bars", familyId: "soft-core" },
  ];
  const families = [
    { id: "bars-new", organisationId: "org", name: "Carb Killa Protein Bars", brand: "Grenade", active: true, sortPosition: 0 },
    { id: "bars-legacy", organisationId: "org", name: "Grenade - Carb Killa Protein Bar", brand: "Grenade - Carb Killa Bars", active: true, sortPosition: 1 },
    { id: "spread", organisationId: "org", name: "Carb Killa Bar in a Jar Spread", brand: "Grenade", active: true, sortPosition: 2 },
    { id: "rtd", organisationId: "org", name: "Carb Killa Shake RTD", brand: "Grenade", active: true, sortPosition: 3 },
    { id: "soft-core", organisationId: "org", name: "Soft Core Creme Egg Protein Bar", brand: "Grenade - Carb Killa Bars", active: true, sortPosition: 4 },
  ];
  const cards = groupProductFamilies(products, families, "org");
  assert.equal(cards.length, 4);
  const bars = cards.find(card => card.family?.name === "Carb Killa Protein Bars");
  assert.ok(bars);
  assert.equal(bars.variants.length, 2);
  assert.equal(bars.family?.brand, "Grenade");
  assert.deepEqual(availableVariantOptions(bars.variants), { Flavour: ["Birthday Cake", "Chocolate"] });
  assert.deepEqual(new Set(cards.map(card => card.label)), new Set(["Carb Killa Protein Bars", "Carb Killa Bar in a Jar Spread", "Carb Killa Shake RTD", "Soft Core Creme Egg Protein Bar"]));
});

test("Alpha Bottle Jug sizes canonicalize while Shaker V2 and Alpha Pod stay separate", () => {
  const products = [
    { ...product("jug-1600", { size: "1600ml" }), name: "Alpha Bottle Jug", brand: "Alpha Bottle", familyId: "jug" },
    { ...product("jug-2400", { size: "2400ml" }), name: "Alpha Bottle XL Jug", brand: "Alpha Bottle", familyId: "xl-jug" },
    { ...product("jug-xxl", { size: "2400ml", colour: "Black" }), name: "Alpha Bottle XXL Jug", brand: "Alpha Bottle", familyId: "xxl-jug" },
    { ...product("shaker", { Colour: "Black" }), name: "Alpha Bottle Shaker V2", brand: "Alpha Bottle", familyId: "shaker" },
    { ...product("pod", { Colour: "Clear" }), name: "Alpha Pod", brand: "Alpha Bottle", familyId: "pod" },
  ];
  const families = ["jug", "xl-jug", "xxl-jug", "shaker", "pod"].map((id, sortPosition) => ({ id, organisationId: "org", name: id === "xl-jug" ? "Alpha Bottle XL Jug" : id === "xxl-jug" ? "Alpha Bottle XXL Jug" : id === "jug" ? "Alpha Bottle Jug" : id === "shaker" ? "Alpha Bottle Shaker V2" : "Alpha Pod", brand: "Alpha Bottle", active: true, sortPosition }));
  const cards = groupProductFamilies(products, families, "org");
  assert.equal(cards.length, 3);
  const jug = cards.find(card => card.label === "Alpha Bottle Jug");
  assert.ok(jug);
  assert.equal(jug.variants.length, 3);
  const choices = memberVariantChoices(jug.variants, {}, () => true);
  assert.deepEqual(choices.controls.find(control => control.key === "size")?.values.map(item => item.value), ["1600ml", "2400ml"]);
  assert.equal(cards.some(card => card.label === "Alpha Bottle Shaker V2"), true);
  assert.equal(cards.some(card => card.label === "Alpha Pod"), true);
});

test("member and staff shop surfaces use the same canonical Alpha jug family grouping", async () => {
  const fs = await import("node:fs/promises");
  const [memberShop, staffShop] = await Promise.all([
    fs.readFile(new URL("../components/club-shop.tsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../components/club-staff-checkout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(memberShop, /groupProductFamilies\(/);
  assert.match(staffShop, /groupProductFamilies\(/);
  const products = [
    { ...product("jug", { Size: "1600ml" }), name: "Alpha Bottle Jug", familyId: "jug" },
    { ...product("xl", { Size: "2400ml" }), name: "Alpha Bottle XL Jug", familyId: "xl" },
    { ...product("xxl", { Size: "3200ml" }), name: "Alpha Bottle XXL Jug", familyId: "xxl" },
  ];
  const families = products.map((item, sortPosition) => ({ id: item.familyId!, organisationId: "org", name: item.name, brand: "Alpha Bottle", active: true, sortPosition }));
  for (const surface of [memberShop, staffShop]) {
    assert.match(surface, /groupProductFamilies\(/);
    assert.equal(groupProductFamilies(products, families, "org").filter(card => card.label === "Alpha Bottle Jug").length, 1);
  }
});
