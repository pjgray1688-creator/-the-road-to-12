import type { ClubCommerceProduct } from "./club-commerce";

/** The small, member-facing taxonomy shared by catalogue imports and shop filters. */
export const MEMBER_SHOP_CATEGORIES = ["Food & Drinks", "Merch & Apparel", "Supplements", "Services"] as const;
export type MemberShopCategory = (typeof MEMBER_SHOP_CATEGORIES)[number];

export type ProductCategoryInput = {
  name: string;
  supplierCategory?: string;
  productType?: string;
  tags?: string[];
  format?: string;
  category?: string;
};

const text = (value: unknown) => typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
const includesAny = (value: string, words: string[]) => words.some(word => value.includes(word));

/**
 * Infer the member-facing category from all available product metadata. Explicit
 * canonical categories win, while descriptive metadata prevents powder supplements
 * being mistaken for ready-to-consume food just because they contain "protein".
 */
export function inferMemberShopCategory(input: ProductCategoryInput): MemberShopCategory {
  const explicit = [input.category, input.supplierCategory, input.productType].map(text).find(value => MEMBER_SHOP_CATEGORIES.some(category => value === category.toLocaleLowerCase()));
  if (explicit) return MEMBER_SHOP_CATEGORIES.find(category => category.toLocaleLowerCase() === explicit)!;
  const all = [input.name, input.supplierCategory, input.productType, input.format, ...(input.tags ?? [])].map(text).filter(Boolean).join(" ");
  if (includesAny(all, ["service", "coaching", "pt session", "consultation", "appointment"])) return "Services";
  if (includesAny(all, ["merch", "apparel", "clothing", "t-shirt", "hoodie", "shirt", "vest", "shorts"])) return "Merch & Apparel";
  // Powder, creatine, vitamins and pre-workout are prepared supplements, even
  // when a supplier calls them a protein product.
  if (includesAny(all, ["whey", "protein powder", "powder", "creatine", "pre-workout", "pre workout", "amino", "bcaa", "collagen", "glutamine", "vitamin", "mineral", "electrolyte powder", "mass gainer", "supplement", "cream of rice", "powdered rice", "rice powder"])) return "Supplements";
  if (includesAny(all, ["ready to drink", "ready-to-drink", "rtd", "drink", "shake", "bar", "snack", "meal", "food", "water", "coffee", "energy drink"])) return "Food & Drinks";
  // Food is the safer default for a retail item that has no stronger signal;
  // reception can override the inferred value in the operator catalogue.
  return "Food & Drinks";
}

export function effectiveMemberShopCategory(product: ProductCategoryInput, manualOverride?: string): MemberShopCategory {
  const override = text(manualOverride);
  const canonical = MEMBER_SHOP_CATEGORIES.find(category => category.toLocaleLowerCase() === override);
  return canonical ?? inferMemberShopCategory(product);
}

export type ProductAvailability = { localAvailable?: boolean; supplierAvailable?: boolean };

/** Sort the catalogue by useful fulfilment state, then stable relevance/name. */
export function sortMemberShopProducts<T extends ClubCommerceProduct>(products: T[], availability: Map<string, ProductAvailability> | Record<string, ProductAvailability> = new Map(), query = ""): T[] {
  const search = query.trim().toLocaleLowerCase();
  const info = (id: string) => availability instanceof Map ? availability.get(id) : availability[id];
  const rank = (product: T) => {
    const state = info(product.id);
    return state?.localAvailable ? 0 : state?.supplierAvailable ? 1 : 2;
  };
  const relevance = (product: T) => {
    if (!search) return 0;
    const name = product.name.toLocaleLowerCase();
    const brand = product.brand?.toLocaleLowerCase() ?? "";
    return name === search ? 0 : name.startsWith(search) ? 1 : name.includes(search) || brand.includes(search) ? 2 : 3;
  };
  return products.slice().sort((a, b) => relevance(a) - relevance(b) || rank(a) - rank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
