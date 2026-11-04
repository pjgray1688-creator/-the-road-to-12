export const MADHOUSE_ORGANISATION_ID = "fa44592a-1593-4ad3-a621-63a4a4bcbceb";

export const WEBSITE_SHOP_SIZES = ["S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"] as const;

export type WebsiteShopSlug =
  | "acid-black" | "acid-blue" | "acid-brown" | "acid-forest-green" | "acid-pink" | "acid-purple"
  | "hoodie-beige" | "hoodie-forest-green" | "hoodie-charcoal" | "hoodie-white" | "hoodie-light-blue" | "hoodie-pink" | "hoodie-red" | "hoodie-navy" | "hoodie-black"
  | "sweatshirt-white" | "sweatshirt-black" | "sweatshirt-brown" | "sweatshirt-grey" | "sweatshirt-tan" | "sweatshirt-cream";

export type WebsiteShopProposal = {
  familyId: string;
  familyName: "Heavy Oversized T-Shirt" | "Pullover Hoodie" | "Crewneck Sweatshirt";
  variantColour: string;
  reviewNote?: string;
};

/** Proposed, organisation-scoped matches. Club verifies actual variants and photos before publication. */
export const WEBSITE_SHOP_PROPOSALS: Readonly<Record<WebsiteShopSlug, WebsiteShopProposal>> = {
  "acid-black": { familyId: "fccc70d5-2db2-45ab-be4f-3cd728c28aa8", familyName: "Heavy Oversized T-Shirt", variantColour: "Black/Grey", reviewNote: "Website says Black; R12 catalogue says Black/Grey. Confirm garment and image match." },
  "acid-blue": { familyId: "fccc70d5-2db2-45ab-be4f-3cd728c28aa8", familyName: "Heavy Oversized T-Shirt", variantColour: "Blue" },
  "acid-brown": { familyId: "fccc70d5-2db2-45ab-be4f-3cd728c28aa8", familyName: "Heavy Oversized T-Shirt", variantColour: "Brown" },
  "acid-forest-green": { familyId: "fccc70d5-2db2-45ab-be4f-3cd728c28aa8", familyName: "Heavy Oversized T-Shirt", variantColour: "Green", reviewNote: "Website says Forest Green; R12 catalogue says Green. Confirm garment and image match." },
  "acid-pink": { familyId: "fccc70d5-2db2-45ab-be4f-3cd728c28aa8", familyName: "Heavy Oversized T-Shirt", variantColour: "Pink" },
  "acid-purple": { familyId: "fccc70d5-2db2-45ab-be4f-3cd728c28aa8", familyName: "Heavy Oversized T-Shirt", variantColour: "Purple" },
  "hoodie-beige": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Cream", reviewNote: "Website says Beige; R12 catalogue says Cream. Confirm garment and image match." },
  "hoodie-forest-green": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Green", reviewNote: "Website says Forest Green; R12 catalogue says Green. Confirm garment and image match." },
  "hoodie-charcoal": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Charcoal" },
  "hoodie-white": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "White" },
  "hoodie-light-blue": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Light Blue" },
  "hoodie-pink": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Pink" },
  "hoodie-red": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Red" },
  "hoodie-navy": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Navy" },
  "hoodie-black": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Black" },
  "sweatshirt-white": { familyId: "7f1116bb-2d32-408b-ac66-ac7cde04170b", familyName: "Crewneck Sweatshirt", variantColour: "White" },
  "sweatshirt-black": { familyId: "7f1116bb-2d32-408b-ac66-ac7cde04170b", familyName: "Crewneck Sweatshirt", variantColour: "Black" },
  "sweatshirt-brown": { familyId: "7f1116bb-2d32-408b-ac66-ac7cde04170b", familyName: "Crewneck Sweatshirt", variantColour: "Brown", reviewNote: "Website says Chocolate Brown; R12 catalogue says Brown. Confirm garment and image match." },
  "sweatshirt-grey": { familyId: "7f1116bb-2d32-408b-ac66-ac7cde04170b", familyName: "Crewneck Sweatshirt", variantColour: "Grey", reviewNote: "Website says Light Grey; R12 catalogue says Grey. Confirm garment and image match." },
  "sweatshirt-tan": { familyId: "7f1116bb-2d32-408b-ac66-ac7cde04170b", familyName: "Crewneck Sweatshirt", variantColour: "Tan" },
  "sweatshirt-cream": { familyId: "7f1116bb-2d32-408b-ac66-ac7cde04170b", familyName: "Crewneck Sweatshirt", variantColour: "Cream" },
};

export type CatalogueVariantPrice = { size: unknown; active: boolean; sellPriceMinor: number | null };

/** Only return the catalogue fallback when exactly the eight expected active sizes share one valid price. */
export function uniformActiveCataloguePrice(variants: readonly CatalogueVariantPrice[]): number | null {
  const active = variants.filter(variant => variant.active);
  if (active.length !== WEBSITE_SHOP_SIZES.length) return null;
  const sizes = active.map(variant => variant.size);
  if (new Set(sizes).size !== WEBSITE_SHOP_SIZES.length
    || !WEBSITE_SHOP_SIZES.every(size => sizes.includes(size))) return null;
  const prices = active.map(variant => variant.sellPriceMinor);
  if (prices.some(price => !Number.isSafeInteger(price) || (price ?? 0) <= 0)) return null;
  return new Set(prices).size === 1 ? prices[0]! : null;
}

export function resolveWebsitePrice(overrideMinor: number | null, variants: readonly CatalogueVariantPrice[]): number | null {
  if (overrideMinor !== null && Number.isSafeInteger(overrideMinor) && overrideMinor > 0) return overrideMinor;
  return overrideMinor === null ? uniformActiveCataloguePrice(variants) : null;
}
