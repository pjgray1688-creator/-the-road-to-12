import { catalogueSearchMatches, type ClubCommerceProduct } from "./club-commerce";

/** Presentation-only member categories; supplier/category records remain untouched. */
export const MEMBER_SHOP_CATEGORIES = ["Services", "Apparel", "Deals", "Protein", "Performance", "Health & Wellness", "Food & Drink", "Accessories"] as const;
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
  packQuantity?: number;
  memberOrderableUnit?: string;
  parentName?: string;
};

const text = (value: unknown) => typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
const includesAny = (value: string, words: string[]) => words.some(word => value.includes(word));

/**
 * Infer the member-facing category from all available product metadata. Explicit
 * canonical categories win except where the requested semantic rules distinguish
 * powders from snacks/drinks. Description text never turns an item into Protein.
 */
export function inferMemberShopCategory(input: ProductCategoryInput): MemberShopCategory | undefined {
  const explicit = [input.category, input.supplierCategory, input.productType].map(text).find(value => MEMBER_SHOP_CATEGORIES.some(category => value === category.toLocaleLowerCase()));
  const explicitCategory = explicit ? MEMBER_SHOP_CATEGORIES.find(category => category.toLocaleLowerCase() === explicit) : undefined;
  const genericCategories = new Set(["food", "food & drink", "food & drinks", "drinks", "drinks and bars", "supplements", "protein"]);
  const categoryTerms = [input.category, input.subcategory, input.supplierCategory].map(text).filter(value => value && !genericCategories.has(value));
  const identity = [input.name, input.parentName, ...categoryTerms, input.productType, input.format, input.memberOrderableUnit, ...(input.tags ?? [])].map(text).filter(Boolean).join(" ");
  const normalized = identity.replace(/[‐‑‒–—]/g, "-");

  if (input.isServiceProduct || explicitCategory === "Services" || includesAny(identity, ["coaching", "pt session", "personal training", "consultation", "appointment", "class credit", "sunbed minutes", "glow zone"])) return "Services";
  if (explicitCategory === "Apparel" || includesAny(identity, ["merch", "apparel", "clothing", "wearable", "t-shirt", "tee shirt", "hoodie", "shirt", "vest", "shorts", "leggings", "joggers"])) return "Apparel";
  if (explicitCategory === "Deals") return "Deals";

  // Broad source buckets are not enough to call an ingestible item food. Use
  // product-format/name evidence and leave unknown products under All Products.
  const isGsnFood = /\bgsn\b/.test(identity) && includesAny(identity, ["wrap", "meal", "prepared", "chicken", "souvlaki"]);
  const isReadyFood = isGsnFood || includesAny(identity, ["gsn:", "gsn meal", "prepared meal", "ready meal", "meal pot", "meal deal", "protein bar", "protein wafer", "protein cookie", "protein brownie", "protein cake", "snack bar", "snack", "cookie", "brownie", "muffin", "chips", "crisps", "peanut butter cup"]);
  const pack = (input.packQuantity ?? 0) > 1 || /\b(?:case|box|multipack|multi-pack|pack|display)\b|\b\d+\s*x\s*\d+(?:\.\d+)?\s*(?:ml|g)\b/.test(normalized);
  const rtd = includesAny(normalized, ["ready to drink", "ready-to-drink", "rtd", "can", "cans", "bottle", "drink", "milkshake", "protein water"]);
  const proteinDrink = includesAny(normalized, ["protein shake", "protein drink", "protein milkshake", "protein rtd"]);
  const singleRtd = rtd && !pack;
  const proteinPowder = includesAny(normalized, ["whey", "casein", "isolate", "beef protein", "vegan protein", "plant protein", "mass gainer", "mass gain", "weight gainer", "instant mass", "mass xl", "heavyweight", "protein powder", "protein sachet", "protein display"])
    && includesAny(normalized, ["powder", "tub", "sachet", "display", "bag", "pouch", "whey", "casein", "isolate", "mass gainer", "mass gain", "weight gainer", "mass xl"]);

  if (proteinDrink && pack && !isReadyFood) return "Protein";
  if (isReadyFood || singleRtd || includesAny(normalized, ["energy drink", "protein water", "hydration drink", "sports drink", "juice", "canned drink", "bottled drink"])) return "Food & Drink";

  const accessoryWrap = includesAny(normalized, ["wrist wrap", "wrist wraps", "knee wrap", "knee wraps", "lifting wrap", "lifting wraps", "training wrap", "training wraps"]);
  if (explicitCategory === "Accessories" || accessoryWrap || includesAny(normalized, ["shaker", "sports bottle", "water bottle", "gym bottle", "jug", "gloves", "lifting strap", "lifting straps", "straps", "knee sleeve", "knee sleeves", "gym bag", "liquid chalk", "chalk block", "gym accessory", "accessories"])) return "Accessories";
  if (explicitCategory === "Health & Wellness" || includesAny(normalized, ["vitamin", "mineral", "omega", "fish oil", "joint support", "liver support", "organ support", "milk thistle", "sleep", "stress", "ashwagandha", "lion's mane", "lions mane", "wellness", "health", "herbal", "adaptogen", "fat burner", "fatburner", "fat loss", "weight management", "weight loss", "appetite suppressant", "thermogenic", "cutting formula", "diet fuel", "animal cuts", "l-carnitine", "carnitine", "curcumin", "magnesium", "zinc", "vitamin d", "d3", "glutathione", "probiotic"])) return "Health & Wellness";
  if (explicitCategory === "Performance" || includesAny(normalized, ["pre-workout", "pre workout", "preworkout", "creatine", "aakg", "amino", "eaa", "bcaa", "intra-workout", "intra workout", "hydration powder", "electrolyte powder", "pump", "performance", "recovery", "beta alanine", "citrulline", "carbohydrate fuel", "cream of rice", "cream of oats", "oat powder", "bulk oats", "carbohydrate powder", "powdered meal replacement", "meal replacement powder"])) return "Performance";
  if ((explicitCategory === "Protein" || proteinPowder) && proteinPowder && !isReadyFood && !singleRtd) return "Protein";
  if (explicitCategory === "Food & Drink" && (isReadyFood || rtd)) return "Food & Drink";
  return undefined;
}

export function effectiveMemberShopCategory(product: ProductCategoryInput, manualOverride?: string): MemberShopCategory | undefined {
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
      || (input.category === "Deals" ? deals.has(product.id) : effectiveMemberShopCategory({ name: product.name, category: product.category, format: product.variantOptions ? Object.values(product.variantOptions).join(" ") : undefined, packQuantity: product.unitsPerSource, memberOrderableUnit: product.unitLabel, isServiceProduct: product.isServiceProduct }) === input.category);
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
