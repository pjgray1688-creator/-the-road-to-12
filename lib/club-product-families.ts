import { canonicalSupplierFamilyBaseName, canonicalSupplierFamilyDisplayName, type ClubCommerceProduct } from "./club-commerce";
import { canonicalMemberBrandName } from "./club-product-taxonomy";

export type ClubProductFamily = { id: string; organisationId: string; name: string; brand?: string; description?: string; category?: string; active: boolean; archivedAt?: string; sortPosition: number };
export type FamilyCard = { family?: ClubProductFamily; variants: ClubCommerceProduct[]; label: string; priceLabel: string };

/** Cards are renderable only when at least one active, priced variant can be
 * offered in the current shop context. Use this exact predicate for both tile
 * rendering and pagination totals. */
export function isRenderableFamilyCard(card: FamilyCard, availability: Record<string, string> = {}) {
  return card.variants.some(product => {
    if (!product.active || product.sellPriceMinor <= 0) return false;
    const state = availability[product.id] ?? (product.isServiceProduct || product.stockTracked ? "IN_GYM" : product.supplierAvailabilityStatus === "available" && product.supplierMemberOrderable !== false ? "SUPPLIER_ORDER" : "UNAVAILABLE");
    return state !== "UNAVAILABLE";
  });
}

export function filterRenderableFamilyCards(cards: FamilyCard[], availability: Record<string, string> = {}) {
  return cards.filter(card => isRenderableFamilyCard(card, availability));
}

const selectable = (p: ClubCommerceProduct) => p.active;
const stable = (a: ClubCommerceProduct, b: ClubCommerceProduct) => a.id.localeCompare(b.id);
const isGsnProduct = (product: ClubCommerceProduct) => product.brand?.trim().toLowerCase() === "gsn" || product.category?.trim().toLowerCase().startsWith("gsn:");
/** Supplier provenance is carried by the linked supplier reference/status.  Do
 * not infer it from orderability: a local product may be orderable too. */
const isSupplierFamilyProduct = (product: ClubCommerceProduct) => Boolean(product.familyId && (product.supplierAvailabilityStatus !== undefined || product.supplierReference?.startsWith("supplier_product:")));
const canonicalGrenadeFamilyTitle = (value: string) => value.replace(/^\s*grenade(?:\s*[-–—/]\s*carb\s*killa\s*bars?)?\s*/i, "").trim() || value.trim();
const familySlug = (value: string) => value.toLocaleLowerCase()
  .replace(/\balpha\s*bottle\s+(?:xl\s+|xxl\s+)?jug\b/g, "alpha bottle jug")
  .replace(/\bcarb\s*killa\s+protein\s+bars?\b/g, "carb killa protein bars")
  .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "-");
export function supplierFormatClass(product: ClubCommerceProduct): string {
  const options = product.variantOptions ?? {};
  const text = `${product.name} ${options.size ?? ""} ${options.orderUnit ?? ""}`.toLowerCase();
  const pack = /\b(?:case|box|pack)\b/.test(text) || /\b\d+\s*x\s*\d+(?:\.\d+)?\s*(?:ml|g|kg)\b/.test(text);
  if (/\b(?:sachet|single serving)\b/.test(text)) return pack ? "sachet-case" : "single-sachet";
  if (/\b(?:can|cans|rtd)\b/.test(text)) return pack ? "can-case" : "single-can";
  if (/\b(?:shot|shots)\b/.test(text)) return pack ? "shot-case" : "single-shot";
  if (/\b(?:gel|gels)\b/.test(text)) return pack ? "gel-case" : "gel";
  if (/\bshaker\b/.test(text)) return "shaker";
  if (/\b(?:tablet|tablets|capsule|capsules|caps)\b/.test(text)) return "tablets";
  return "tub";
}
const formatKey = (product: ClubCommerceProduct) => {
  const options = product.variantOptions ?? {};
  const text = `${product.name} ${options.size ?? ""}`.toLowerCase();
  if (!/\b(?:single|sachet|shot|shots|can|cans|gel|gels|shaker|rtd|tablet|capsule|tub)\b|\b\d+\s*x\s*\d+(?:\.\d+)?\s*(?:ml|g)\b|\b\d+(?:\.\d+)?\s*(?:kg|g|ml)\b/.test(text)) return "";
  return [options.size, options.packQuantity, options.orderUnit].map(value => value?.trim().toLowerCase() ?? "").join("|");
};
export function groupProductFamilies(products: ClubCommerceProduct[], families: ClubProductFamily[], organisationId: string, availability: Record<string, string> = {}): FamilyCard[] {
  const originalFamilies = new Map(families.filter(f => f.organisationId === organisationId).map(f => [f.id, f]));
  const eligibleProducts = products.filter(product => product.organisationId === organisationId && selectable(product) && (!product.familyId || !originalFamilies.has(product.familyId) || (originalFamilies.get(product.familyId)!.active && !originalFamilies.get(product.familyId)!.archivedAt)));
  const presentationFamily = (product: ClubCommerceProduct) => {
    const familyName = product.familyId ? originalFamilies.get(product.familyId)?.name ?? "" : "";
    const familyBrand = product.familyId ? originalFamilies.get(product.familyId)?.brand : undefined;
    const canonicalBrand = canonicalMemberBrandName(product.brand ?? familyBrand);
    const identity = `${product.name} ${familyName}`.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (/alpha\s*bottle\s+(?:xl\s+|xxl\s+)?jug\b/.test(identity)) return { id: "presentation:alpha-bottle-jug", name: "Alpha Bottle Jug", brand: canonicalBrand || "Alpha Bottle" };
    if (canonicalBrand === "Grenade" && /carb\s*killa/.test(identity)) {
      // Keep distinct Carb Killa formats separate (bars, spread, RTD, Soft Core).
      // Only normalise legacy brand spelling and equivalent singular/plural bar parents.
      const title = canonicalGrenadeFamilyTitle(familyName || product.name);
      const slug = familySlug(title);
      const displayName = /carb\s*killa\s+protein\s+bars?/i.test(title) ? "Carb Killa Protein Bars" : title.trim();
      return { id: `presentation:grenade:${slug}`, name: displayName, brand: "Grenade" };
    }
    return undefined;
  };
  const normalizedProducts = eligibleProducts.map(product => {
    const presentation = presentationFamily(product);
    const familyBrand = product.familyId ? originalFamilies.get(product.familyId)?.brand : undefined;
    const canonicalBrand = canonicalMemberBrandName(product.brand ?? familyBrand);
    return { product: { ...product, ...(canonicalBrand ? { brand: canonicalBrand } : {}), ...(presentation ? { familyId: presentation.id } : {}) }, presentation };
  });
  const allowed = new Map(families.filter(f => f.organisationId === organisationId && f.active && !f.archivedAt).map(f => [f.id, { ...f, ...(f.brand ? { brand: canonicalMemberBrandName(f.brand) } : {}) }]));
  for (const { presentation } of normalizedProducts) if (presentation && !allowed.has(presentation.id)) allowed.set(presentation.id, { ...presentation, organisationId, active: true, sortPosition: 0 });
  const grouped = new Map<string, ClubCommerceProduct[]>(); const ungrouped: ClubCommerceProduct[] = [];
  for (const { product, presentation } of normalizedProducts) {
    if (product.familyId) { if (!allowed.has(product.familyId)) allowed.set(product.familyId, { id: product.familyId, organisationId, name: product.name, ...(product.brand ? { brand: product.brand } : {}), ...(product.category ? { category: product.category } : {}), active: true, sortPosition: 0 }); const gsnStandalone = isGsnProduct(product); const supplierFamily = isSupplierFamilyProduct(product); const supplierFormat = supplierFamily ? supplierFormatClass(product) : ""; const key = gsnStandalone ? `${product.familyId}::${product.id}` : presentation ? `${product.familyId}::canonical` : supplierFamily ? `${product.familyId}::${supplierFormat}` : `${product.familyId}::${formatKey(product)}`; const list = grouped.get(key) ?? []; list.push(product); grouped.set(key, list); } else ungrouped.push(product);
  }
  const cards: FamilyCard[] = [];
  for (const [groupKey, variants] of grouped) { const orderable = variants.some(v => availability[v.id] !== "UNAVAILABLE" && v.sellPriceMinor > 0); if (Object.keys(availability).length && !orderable) continue; const family = allowed.get(variants[0].familyId!)!; const presentation = variants[0].familyId?.startsWith("presentation:"); const orderedSource = variants.slice().sort((a, b) => (a.name.toLocaleLowerCase().includes("carb killa") ? 1 : 0) - (b.name.toLocaleLowerCase().includes("carb killa") ? 1 : 0) || stable(a, b)); const ordered = presentation && variants[0].familyId?.startsWith("presentation:grenade:") ? orderedSource.filter((variant, index, all) => all.findIndex(other => `${other.name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${JSON.stringify(other.variantOptions ?? {})}` === `${variant.name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${JSON.stringify(variant.variantOptions ?? {})}`) === index) : orderedSource; const prices = [...new Set(ordered.filter(v => availability[v.id] !== "UNAVAILABLE").map(v => v.sellPriceMinor).filter(v => v > 0))].sort((a, b) => a - b); const supplierFamily = isSupplierFamilyProduct(ordered[0]); const format = supplierFamily ? supplierFormatClass(ordered[0]) : ""; const canonicalNames = supplierFamily ? new Set(ordered.map(product => canonicalSupplierFamilyBaseName(product.name))) : new Set<string>(); const sharedSupplierName = supplierFamily && canonicalNames.size === 1 && new Set(ordered.map(product => product.name)).size > 1 ? canonicalSupplierFamilyDisplayName(ordered[0].name) : family.name; const displayFamily = sharedSupplierName ? { ...family, name: sharedSupplierName } : family; const label = presentation ? family.name : supplierFamily && format === "tub" ? displayFamily.name : supplierFamily || !formatKey(ordered[0]) ? displayFamily.name : ordered[0].variantOptions?.size ? `${displayFamily.name} · ${ordered[0].variantOptions.size}` : displayFamily.name; cards.push({ family: { ...displayFamily, id: groupKey }, variants: ordered, label, priceLabel: prices.length === 1 ? money(prices[0]) : prices.length ? `From ${money(prices[0])}` : "" }); }
  for (const product of ungrouped.sort((a, b) => a.name.localeCompare(b.name) || stable(a, b))) cards.push({ variants: [product], label: product.name, priceLabel: money(product.sellPriceMinor) });
  const finalCards = Object.keys(availability).length ? filterRenderableFamilyCards(cards, availability) : cards;
  return finalCards.sort((a, b) => {
    const priority = (card: FamilyCard) => card.variants.some(v => availability[v.id] === "IN_GYM") ? 0 : card.variants.some(v => availability[v.id] === "OTHER_GYM") ? 1 : card.variants.some(v => availability[v.id] === "SUPPLIER_ORDER") ? 2 : 3;
    return priority(a) - priority(b) || a.label.localeCompare(b.label);
  });
}
export function availableVariantOptions(variants: ClubCommerceProduct[], selected: Record<string, string> = {}): Record<string, string[]> {
  const matching = variants.filter(selectable).filter(v => Object.entries(selected).every(([key, value]) => v.variantOptions?.[key] === value)); const values: Record<string, Set<string>> = {};
  for (const variant of matching) for (const [key, value] of Object.entries(variant.variantOptions ?? {})) (values[key] ??= new Set()).add(value);
  return Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, set]) => [key, [...set].sort()]));
}
export function resolveProductVariant(variants: ClubCommerceProduct[], selected: Record<string, string>): ClubCommerceProduct | undefined {
  const active = variants.filter(selectable);
  if (active.length === 1) return active[0];
  const keys = Object.keys(active[0]?.variantOptions ?? {}); if (!keys.length || keys.some(key => !selected[key])) return undefined;
  const matches = active.filter(v => keys.every(key => v.variantOptions?.[key] === selected[key])); return matches.length === 1 ? matches[0] : undefined;
}
export function money(minor: number) { return minor > 0 ? `£${(minor / 100).toFixed(2)}` : "Price not set"; }

/** Choose size/order unit before flavour. Real unavailable siblings remain visible,
 * while changing an earlier choice clears dependent choices in the caller. */
export function memberVariantChoices(variants: ClubCommerceProduct[], selection: Record<string, string>, canOrder: (product: ClubCommerceProduct) => boolean) {
  const keys = [...new Set(variants.flatMap(variant => Object.keys(variant.variantOptions ?? {})))].sort((a, b) => {
    const order = ["size", "orderUnit", "packQuantity", "flavour"];
    const rank = (key: string) => order.includes(key) ? order.indexOf(key) : order.length;
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  const effective: Record<string, string> = {};
  const controls: Array<{ key: string; values: Array<{ value: string; disabled: boolean }> }> = [];
  let matching = variants.filter(variant => variant.active);
  for (const key of keys) {
    const values = [...new Set(matching.filter(canOrder).map(variant => variant.variantOptions?.[key]).filter((value): value is string => Boolean(value)))].sort();
    if (!values.length) continue;
    controls.push({ key, values: values.map(value => ({ value, disabled: !matching.some(variant => variant.variantOptions?.[key] === value && canOrder(variant)) })) });
    const chosen = values.includes(selection[key]) ? selection[key] : values.length === 1 ? values[0] : undefined;
    if (!chosen) break;
    effective[key] = chosen;
    matching = matching.filter(variant => variant.variantOptions?.[key] === chosen);
  }
  return { controls, effective, resolved: matching.length === 1 && Object.keys(matching[0].variantOptions ?? {}).every(key => effective[key]) ? matching[0] : variants.length === 1 && !keys.length ? variants[0] : undefined };
}
