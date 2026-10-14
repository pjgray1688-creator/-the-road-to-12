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
  if (explicitCategory === "Deals") return "Deals";

  // Source buckets are noisy. Resolve clearly consumable food first, then
  // powders/supplements, and only classify a beverage when its format supports it.
  const pack = (input.packQuantity ?? 0) > 1 || /\b(?:case|box|multipack|multi-pack|pack|display)\b|\b\d+\s*x\s*\d+(?:\.\d+)?\s*(?:ml|g)\b/.test(normalized);
  const productName = text(input.name);
  const namedBottleAccessory = includesAny(productName, ["water bottle", "sports bottle", "gym bottle", "alpha bottle", "bottle jug", "bottle shaker"]) || /^bottle(?:\s|$)/.test(productName);
  const powderOrSupplementFormat = includesAny(normalized, ["powder", "tub", "sachet", "capsule", "tablet", "supplement"]);
  const foodName = [input.name, input.parentName].map(text).filter(Boolean).join(" ").replace(/[‐‑‒–—]/g, "-");
  const foodCategoryEvidence = categoryTerms.some(value => /^(?:snacks?|protein bars?|energy bars?|ready meals?)$/.test(value));
  const foodSnack = /\b(?:protein\s+)?(?:bars?|cookies?|brownies?|wafers?|muffins?|chips|crisps|snacks?|peanut butter cups?)\b/.test(foodName) || foodCategoryEvidence;
  const gsnFood = /\bgsn\b/.test(identity) && includesAny(identity, ["wrap", "meal", "prepared", "chicken", "souvlaki"]);
  const foodWrap = /\b(?:tortilla|chicken|souvlaki|bbq)\b.*\bwrap\b|\bwrap\b.*\b(?:tortilla|chicken|food)\b/.test(normalized);
  const isReadyFood = foodSnack || gsnFood || foodWrap || includesAny(normalized, ["gsn meal", "prepared meal", "ready meal", "meal pot", "meal deal"]);
  const proteinDrink = includesAny(normalized, ["protein shake", "protein drink", "protein milkshake", "protein rtd", "protein water"]);
  const beverageEvidence = includesAny(normalized, ["ready to drink", "ready-to-drink", "rtd", "canned drink", "bottled drink", "can", "cans", "energy drink", "hydration drink", "sports drink", "milkshake", "protein shake", "protein drink", "protein water", "juice"]);
  const beverageFormat = !powderOrSupplementFormat && !namedBottleAccessory && (beverageEvidence || includesAny(normalized, ["bottle", "ml"]) && includesAny(normalized, ["energy", "hydration", "protein", "juice"]));
  const proteinSnack = foodSnack || includesAny(normalized, ["pancake", "protein pancake"]);
  const proteinPowder = !proteinSnack && includesAny(normalized, ["whey", "casein", "isolate", "beef protein", "vegan protein", "plant protein", "mass gainer", "mass gain", "weight gainer", "instant mass", "mass xl", "heavyweight", "protein powder", "protein sachet", "protein display"])
    && (powderOrSupplementFormat || includesAny(normalized, ["whey", "casein", "isolate", "mass gainer", "mass gain", "weight gainer", "mass xl"]));
  const healthSupplement = explicitCategory === "Health & Wellness" || includesAny(normalized, ["vitamin", "mineral", "omega", "fish oil", "joint support", "liver support", "organ support", "milk thistle", "sleep", "stress", "ashwagandha", "lion's mane", "lions mane", "wellness", "health", "herbal", "adaptogen", "fat burner", "fatburner", "fat loss", "weight management", "weight loss", "appetite suppressant", "thermogenic", "cutting formula", "diet fuel", "animal cuts", "l-carnitine", "carnitine", "curcumin", "magnesium", "zinc", "vitamin d", "d3", "glutathione", "probiotic"]);
  const performanceSupplement = explicitCategory === "Performance" || includesAny(normalized, ["pre-workout", "pre workout", "preworkout", "creatine", "aakg", "amino", "eaa", "bcaa", "intra-workout", "intra workout", "hydration powder", "electrolyte powder", "pump", "performance", "recovery", "beta alanine", "citrulline", "carbohydrate fuel", "cream of rice", "cream of oats", "oat powder", "bulk oats", "carbohydrate powder", "powdered meal replacement", "meal replacement powder"]);

  if (isReadyFood) return "Food & Drink";
  if (proteinDrink && pack && !powderOrSupplementFormat) return "Protein";
  if (healthSupplement) return "Health & Wellness";
  if (performanceSupplement) return "Performance";
  if (proteinPowder && !beverageFormat) return "Protein";
  const pantryFood = includesAny(normalized, ["oats", "oatmeal", "rice", "spread", "sauce", "syrup", "nut butter"]) && !includesAny(normalized, ["cream of rice", "cream of oats", "oat powder", "rice powder", "powdered", "supplement"]);
  if ((explicitCategory === "Food & Drink" || pantryFood || beverageFormat) && !powderOrSupplementFormat) return "Food & Drink";

  const physicalAccessory = includesAny(normalized, ["shaker", "gallon jug", "hydration jug", "water jug", "gym jug", "alpha pod", "storage pod", "storage case", "storage container", "pill organizer", "gloves", "lifting strap", "lifting straps", "straps", "knee sleeve", "knee sleeves", "elbow sleeve", "elbow sleeves", "gym bag", "liquid chalk", "chalk block", "smelling salts", "tacky remover", "tacky", "lifting belt", "weightlifting belt", "gym belt", "lifting hooks", "wrist hooks", "grip straps", "hand grips", "lifting grips", "gym accessory", "accessories"])
    || /\b(?:lifting|wrist|gym) hooks?\b|\b(?:hand|lifting|gym) grips?\b/.test(normalized);
  const contextualWrap = /\b(?:wrist|knee|lifting|training)\s+wraps?\b/.test(normalized);
  const bottleOrJug = namedBottleAccessory || /\bjug\b/.test(normalized);
  if (explicitCategory === "Accessories" || physicalAccessory || contextualWrap || bottleOrJug) return "Accessories";
  if (explicitCategory === "Apparel" || includesAny(identity, ["merch", "apparel", "clothing", "wearable", "t-shirt", "tee shirt", "hoodie", "shirt", "vest", "shorts", "leggings", "joggers"])) return "Apparel";
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

export function canonicalMemberBrandName(brand?: string): string {
  const label = (brand ?? "").trim().replace(/\s+/g, " ");
  if (!label) return "";
  const normalized = normalBrand(label);
  if (normalized.includes("grenade") && normalized.includes("carbkilla")) return "Grenade";
  const featuredId = featuredMemberBrandId(label);
  return featuredId ? FEATURED_MEMBER_BRANDS.find(item => item.id === featuredId)!.label : label;
}

export function memberShopBrandOptions(brands: Array<string | undefined>): string[] {
  return [...new Set(brands.map(canonicalMemberBrandName).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function matchesFeaturedMemberBrand(brand: string | undefined, selected: string): boolean {
  if (!selected) return true;
  const featured = FEATURED_MEMBER_BRANDS.find(item => item.id === selected);
  return featured ? featuredMemberBrandId(brand) === featured.id : canonicalMemberBrandName(brand) === canonicalMemberBrandName(selected);
}

export function filterMemberShopProducts<T extends ClubCommerceProduct>(products: T[], input: { category: string; brand: string; query: string; dealProductIds?: ReadonlySet<string> }): T[] {
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
