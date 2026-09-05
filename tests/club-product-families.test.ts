import test from "node:test";
import assert from "node:assert/strict";
import { availableVariantOptions, groupProductFamilies, resolveProductVariant } from "../lib/club-product-families";
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
