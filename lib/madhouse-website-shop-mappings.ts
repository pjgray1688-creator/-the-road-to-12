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

/** Fixed, approved organisation-scoped links from the showroom to R12 variants. */
export const WEBSITE_SHOP_MAPPINGS: Readonly<Record<WebsiteShopSlug, WebsiteShopProposal>> = {
  "acid-black": { familyId: "fccc70d5-2db2-45ab-be4f-3cd728c28aa8", familyName: "Heavy Oversized T-Shirt", variantColour: "Black/Grey" },
  "acid-blue": { familyId: "fccc70d5-2db2-45ab-be4f-3cd728c28aa8", familyName: "Heavy Oversized T-Shirt", variantColour: "Blue" },
  "acid-brown": { familyId: "fccc70d5-2db2-45ab-be4f-3cd728c28aa8", familyName: "Heavy Oversized T-Shirt", variantColour: "Brown" },
  "acid-forest-green": { familyId: "fccc70d5-2db2-45ab-be4f-3cd728c28aa8", familyName: "Heavy Oversized T-Shirt", variantColour: "Green" },
  "acid-pink": { familyId: "fccc70d5-2db2-45ab-be4f-3cd728c28aa8", familyName: "Heavy Oversized T-Shirt", variantColour: "Pink" },
  "acid-purple": { familyId: "fccc70d5-2db2-45ab-be4f-3cd728c28aa8", familyName: "Heavy Oversized T-Shirt", variantColour: "Purple" },
  "hoodie-beige": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Cream" },
  "hoodie-forest-green": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Green" },
  "hoodie-charcoal": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Charcoal" },
  "hoodie-white": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "White" },
  "hoodie-light-blue": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Light Blue" },
  "hoodie-pink": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Pink" },
  "hoodie-red": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Red" },
  "hoodie-navy": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Navy" },
  "hoodie-black": { familyId: "912a3ec3-c8cc-48c0-9d20-9223584d0714", familyName: "Pullover Hoodie", variantColour: "Black" },
  "sweatshirt-white": { familyId: "7f1116bb-2d32-408b-ac66-ac7cde04170b", familyName: "Crewneck Sweatshirt", variantColour: "White" },
  "sweatshirt-black": { familyId: "7f1116bb-2d32-408b-ac66-ac7cde04170b", familyName: "Crewneck Sweatshirt", variantColour: "Black" },
  "sweatshirt-brown": { familyId: "7f1116bb-2d32-408b-ac66-ac7cde04170b", familyName: "Crewneck Sweatshirt", variantColour: "Brown" },
  "sweatshirt-grey": { familyId: "7f1116bb-2d32-408b-ac66-ac7cde04170b", familyName: "Crewneck Sweatshirt", variantColour: "Grey" },
  "sweatshirt-tan": { familyId: "7f1116bb-2d32-408b-ac66-ac7cde04170b", familyName: "Crewneck Sweatshirt", variantColour: "Tan" },
  "sweatshirt-cream": { familyId: "7f1116bb-2d32-408b-ac66-ac7cde04170b", familyName: "Crewneck Sweatshirt", variantColour: "Cream" },
};

/** Kept as an alias for callers compiled against the first Stage 1 API. */
export const WEBSITE_SHOP_PROPOSALS = WEBSITE_SHOP_MAPPINGS;

export type CatalogueVariantPrice = { size: unknown; active: boolean; sellPriceMinor: number | null };

/** Use the catalogue fallback when the enabled active variants share one valid price. */
export function uniformActiveCataloguePrice(variants: readonly CatalogueVariantPrice[]): number | null {
  const active = variants.filter(variant => variant.active);
  if (active.length === 0 || active.length > WEBSITE_SHOP_SIZES.length) return null;
  const sizes = active.map(variant => variant.size);
  if (new Set(sizes).size !== active.length
    || sizes.some(size => typeof size !== "string" || !WEBSITE_SHOP_SIZES.includes(size as typeof WEBSITE_SHOP_SIZES[number]))) return null;
  const prices = active.map(variant => variant.sellPriceMinor);
  if (prices.some(price => !Number.isSafeInteger(price) || (price ?? 0) <= 0)) return null;
  return new Set(prices).size === 1 ? prices[0]! : null;
}

export function resolveWebsitePrice(overrideMinor: number | null, variants: readonly CatalogueVariantPrice[]): number | null {
  if (overrideMinor !== null && Number.isSafeInteger(overrideMinor) && overrideMinor > 0) return overrideMinor;
  return overrideMinor === null ? uniformActiveCataloguePrice(variants) : null;
}
