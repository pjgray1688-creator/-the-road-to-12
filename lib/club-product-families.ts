import type { ClubCommerceProduct } from "./club-commerce";

export type ClubProductFamily = { id: string; organisationId: string; name: string; brand?: string; description?: string; category?: string; active: boolean; archivedAt?: string; sortPosition: number };
export type FamilyCard = { family?: ClubProductFamily; variants: ClubCommerceProduct[]; label: string; priceLabel: string };

const selectable = (p: ClubCommerceProduct) => p.active;
const stable = (a: ClubCommerceProduct, b: ClubCommerceProduct) => a.id.localeCompare(b.id);
export function groupProductFamilies(products: ClubCommerceProduct[], families: ClubProductFamily[], organisationId: string): FamilyCard[] {
  const allowed = new Map(families.filter(f => f.organisationId === organisationId && f.active && !f.archivedAt).map(f => [f.id, f]));
  const grouped = new Map<string, ClubCommerceProduct[]>(); const ungrouped: ClubCommerceProduct[] = [];
  for (const product of products.filter(p => p.organisationId === organisationId && selectable(p))) {
    if (product.familyId) { if (!allowed.has(product.familyId)) allowed.set(product.familyId, { id: product.familyId, organisationId, name: product.name, ...(product.brand ? { brand: product.brand } : {}), ...(product.category ? { category: product.category } : {}), active: true, sortPosition: 0 }); const list = grouped.get(product.familyId) ?? []; list.push(product); grouped.set(product.familyId, list); } else ungrouped.push(product);
  }
  const cards: FamilyCard[] = [];
  for (const [id, variants] of grouped) { const family = allowed.get(id)!; const ordered = variants.slice().sort(stable); const prices = [...new Set(ordered.map(v => v.sellPriceMinor))].sort((a, b) => a - b); cards.push({ family, variants: ordered, label: family.name, priceLabel: prices.length === 1 ? money(prices[0]) : `From ${money(prices[0])}` }); }
  for (const product of ungrouped.sort((a, b) => a.name.localeCompare(b.name) || stable(a, b))) cards.push({ variants: [product], label: product.name, priceLabel: money(product.sellPriceMinor) });
  return cards.sort((a, b) => a.label.localeCompare(b.label));
}
export function availableVariantOptions(variants: ClubCommerceProduct[], selected: Record<string, string> = {}): Record<string, string[]> {
  const matching = variants.filter(selectable).filter(v => Object.entries(selected).every(([key, value]) => v.variantOptions?.[key] === value)); const values: Record<string, Set<string>> = {};
  for (const variant of matching) for (const [key, value] of Object.entries(variant.variantOptions ?? {})) (values[key] ??= new Set()).add(value);
  return Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, set]) => [key, [...set].sort()]));
}
export function resolveProductVariant(variants: ClubCommerceProduct[], selected: Record<string, string>): ClubCommerceProduct | undefined {
  const keys = Object.keys(variants.find(selectable)?.variantOptions ?? {}); if (!keys.length || keys.some(key => !selected[key])) return undefined;
  const matches = variants.filter(selectable).filter(v => keys.every(key => v.variantOptions?.[key] === selected[key])); return matches.length === 1 ? matches[0] : undefined;
}
export function money(minor: number) { return `£${(minor / 100).toFixed(2)}`; }
