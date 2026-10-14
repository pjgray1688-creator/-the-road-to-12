import { catalogueSearchMatches, type ClubCommerceProduct } from "./club-commerce";

/** Presentation-only member categories; supplier/category records remain untouched. */
export const MEMBER_SHOP_CATEGORIES = ["Services", "Apparel", "Deals", "Protein", "Performance", "Health & Wellness", "Weight Management", "Food, Snacks & Accessories"] as const;
export type MemberShopCategory = (typeof MEMBER_SHOP_CATEGORIES)[number];

export const FEATURED_MEMBER_BRANDS = [
  { id: "applied-nutrition", label: "Applied Nutrition" },
  { id: "dorian-yates", label: "Dorian Yates" },
  { id: "scitec-nutrition", label: "Scitec Nutrition" },
  { id: "reflex-nutrition", label: "Reflex Nutrition" },
  { id: "black-mamba", label: "Black Mamba" },
  { id: "cnp-professional", label: "CNP Professional" },
] as const;
export type FeaturedMemberBrandId = (typeof FEATURED_MEMBER_BRANDS)[number]["id"];

export type ProductCategoryInput = {
  name: string;
  supplierCategory?: string;
  productType?: string;
  tags?: string[];
  format?: string;
  category?: string;
  subcategory?: string;
  description?: string;
  isServiceProduct?: boolean;
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
  const genericLegacyCategories = new Set(["food & drinks", "supplements"]);
  const all = [input.name, input.category, input.subcategory, input.supplierCategory, input.productType, input.format, input.description, ...(input.tags ?? [])].map(text).filter(value => value && !genericLegacyCategories.has(value)).join(" ");
  if (input.isServiceProduct || includesAny(all, ["service", "coaching", "pt session", "personal training", "consultation", "appointment", "class credit", "sunbed minutes", "glow zone"])) return "Services";
  if (includesAny(all, ["merch", "apparel", "clothing", "wearable", "t-shirt", "tee shirt", "hoodie", "shirt", "vest", "shorts", "leggings", "joggers"])) return "Apparel";
  if (includesAny(all, ["fat burner", "fatburner", "fat loss", "weight management", "weight loss", "appetite suppressant", "thermogenic", "cutting formula", "diet fuel", "animal cuts"])) return "Weight Management";
  // Bars/cookies and pantry-style foods belong with food even when protein is
  // prominent in the product name. Protein powders and protein drinks are separate.
  if (includesAny(all, ["protein bar", "protein wafer", "protein cookie", "protein cake", "brownie", "snack", "bar box", "oats", "porridge", "cream of rice", "rice cake", "syrup", "shaker", "water bottle", "straps", "gloves", "wraps", "sleeves", "accessor", "food", "ready meal", "meal replacement", "coffee"])) return "Food, Snacks & Accessories";
  if (includesAny(all, ["whey", "protein", "casein", "isolate", "mass gainer", "mass gain", "beef xp", "vegan protein", "plant protein", "protein shake", "protein milkshake", "protein rtd"])) return "Protein";
  if (includesAny(all, ["pre-workout", "pre workout", "creatine", "amino", "eaa", "bcaa", "intra-workout", "intra workout", "hydration", "electrolyte", "pump", "performance", "recovery", "beta alanine", "citrulline", "carbohydrate fuel"])) return "Performance";
  if (includesAny(all, ["vitamin", "mineral", "omega", "fish oil", "joint support", "sleep", "stress", "ashwagandha", "wellness", "health", "milk thistle", "d3", "magnesium", "zinc", "collagen", "glutamine"])) return "Health & Wellness";
  if (includesAny(all, ["ready to drink", "ready-to-drink", "rtd", "drink", "water", "bottle", "energy drink", "bar", "meal", "food"])) return "Food, Snacks & Accessories";
  // Existing broad supplier categories are only a final clue, never a reason to
  // rewrite supplier data. Unclassified retail products remain easy to find.
  if (includesAny(all, ["supplement", "nutrition", "capsule", "tablet", "powder"])) return "Performance";
  return "Food, Snacks & Accessories";
}

export function effectiveMemberShopCategory(product: ProductCategoryInput, manualOverride?: string): MemberShopCategory {
  const override = text(manualOverride);
  const canonical = MEMBER_SHOP_CATEGORIES.find(category => category.toLocaleLowerCase() === override);
  return canonical ?? inferMemberShopCategory(product);
}

const normalBrand = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
const featuredBrandAliases: Record<FeaturedMemberBrandId, string[]> = {
  "applied-nutrition": ["appliednutrition"],
  "dorian-yates": ["dorianyates", "dynutrition", "shadowline"],
  "scitec-nutrition": ["scitec", "scitecnutrition"],
  "reflex-nutrition": ["reflex", "reflexnutrition"],
  "black-mamba": ["blackmamba", "blackmambareaper"],
  "cnp-professional": ["cnp", "cnpprofessional"],
};

export function featuredMemberBrandId(brand?: string): FeaturedMemberBrandId | undefined {
  const normalized = normalBrand(brand ?? "");
  return FEATURED_MEMBER_BRANDS.find(item => featuredBrandAliases[item.id].some(alias => normalized.includes(alias)))?.id;
}

export function matchesFeaturedMemberBrand(brand: string | undefined, selected: FeaturedMemberBrandId | ""): boolean {
  return !selected || featuredMemberBrandId(brand) === selected;
}

export function filterMemberShopProducts<T extends ClubCommerceProduct>(products: T[], input: { category: string; brand: FeaturedMemberBrandId | ""; query: string; dealProductIds?: ReadonlySet<string> }): T[] {
  const deals = input.dealProductIds ?? new Set<string>();
  return products.filter(product => {
    const inCategory = input.category === "All"
      || (input.category === "Deals" ? deals.has(product.id) : effectiveMemberShopCategory({ name: product.name, category: product.category, description: product.description, format: product.variantOptions ? Object.values(product.variantOptions).join(" ") : undefined, isServiceProduct: product.isServiceProduct }) === input.category);
    return inCategory && matchesFeaturedMemberBrand(product.brand, input.brand) && catalogueSearchMatches(product, input.query);
  });
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
