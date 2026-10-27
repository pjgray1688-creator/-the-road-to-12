import assert from "node:assert/strict";
import test from "node:test";
import type { ClubCommerceProduct } from "../lib/club-commerce";
import { winterBundleSavingMinor } from "../lib/club-member-basket";
import { memberProductFamilyTitle, memberVariantChoices } from "../lib/club-product-families";

const apparel = (size: string): ClubCommerceProduct => ({
  id: `tee-${size}`,
  organisationId: "org",
  name: `Heavy Oversized T-Shirt · Black · ${size}`,
  brand: "Madhouse Apparel",
  active: true,
  stockTracked: false,
  sellPriceMinor: 2500,
  currency: "GBP",
  variantOptions: { colour: "Black", size },
  createdAt: "",
  updatedAt: "",
});

test("Madhouse apparel uses its family title without changing variant names", () => {
  const variant = apparel("2XL");
  assert.equal(memberProductFamilyTitle(variant.name, variant), "Heavy Oversized T-Shirt");
  assert.equal(variant.name, "Heavy Oversized T-Shirt · Black · 2XL");
});

test("Madhouse apparel sizes use garment order", () => {
  const unordered = ["5XL", "2XL", "M", "XL", "S", "4XL", "L", "3XL"].map(apparel);
  const choices = memberVariantChoices(unordered, { colour: "Black" }, () => true);
  assert.deepEqual(choices.controls.find(control => control.key === "size")?.values.map(item => item.value), ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"]);
});

test("winter offer label reads authoritative savings without calculating another discount", () => {
  const applied = [{ promotion_name: "Madhouse Winter Hoodie + T-Shirt", saving_minor: 1250, applied_saving_minor: 1250 }];
  assert.equal(winterBundleSavingMinor(applied), 1250);
  assert.equal(winterBundleSavingMinor([{ promotion_name: "Monthly Golden Ticket", applied_saving_minor: 500 }]), 0);
});
