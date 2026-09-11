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
    const values = [...new Set(matching.map(variant => variant.variantOptions?.[key]).filter((value): value is string => Boolean(value)))].sort();
    if (!values.length) continue;
    controls.push({ key, values: values.map(value => ({ value, disabled: !matching.some(variant => variant.variantOptions?.[key] === value && canOrder(variant)) })) });
    const chosen = values.includes(selection[key]) ? selection[key] : values.length === 1 ? values[0] : undefined;
    if (!chosen) break;
    effective[key] = chosen;
    matching = matching.filter(variant => variant.variantOptions?.[key] === chosen);
  }
  return { controls, effective, resolved: matching.length === 1 && Object.keys(matching[0].variantOptions ?? {}).every(key => effective[key]) ? matching[0] : variants.length === 1 && !keys.length ? variants[0] : undefined };
}
