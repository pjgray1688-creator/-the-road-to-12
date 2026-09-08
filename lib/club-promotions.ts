export type PromotionLine = { id: string; productId: string; category?: string; unitPriceMinor: number; quantity: number };
export type PromotionRule = { id: string; status: "draft"|"active"|"paused"|"expired"; startsAt: string; endsAt?: string; locationIds?: string[]; effect: "percentage"|"fixed"|"fixed_price"|"bundle"; valueMinor?: number; percentageBasisPoints?: number; priority?: number; combinable?: boolean; eligibility?: unknown; bundleGroups?: BundleGroup[]; bundlePriceMinor?: number; repeatable?: boolean };
export function promotionIsActive(rule: PromotionRule, now: Date, locationId?: string) { return rule.status === "active" && new Date(rule.startsAt) <= now && (!rule.endsAt || now < new Date(rule.endsAt)) && (!rule.locationIds?.length || (locationId ? rule.locationIds.includes(locationId) : false)); }
export function applyPromotion(subtotalMinor: number, rule: PromotionRule): number { const saving = rule.effect === "percentage" ? Math.floor(subtotalMinor * Math.max(0, Math.min(10000, rule.percentageBasisPoints ?? 0)) / 10000) : rule.effect === "fixed_price" ? Math.max(0, subtotalMinor - (rule.valueMinor ?? 0)) : rule.effect === "bundle" ? 0 : Math.max(0, rule.valueMinor ?? 0); return Math.min(subtotalMinor, saving); }
export type GoldenCandidate = { id: string; label: string; eligibleMinor: number };
export function chooseGoldenTicketCandidate(candidates: GoldenCandidate[]) { return [...candidates].sort((a,b) => b.eligibleMinor-a.eligibleMinor || a.id.localeCompare(b.id))[0]; }
export type BundleGroup = { id?: string; required: number; productIds?: string[]; categories?: string[] };
export type BundleAllocation = { qualifies: boolean; lines: PromotionLine[]; savingMinor: number; bundleCount: number; bundles: PromotionLine[][] };
const matches = (line: PromotionLine, group: BundleGroup) => (!group.productIds || group.productIds.includes(line.productId)) && (!group.categories || (line.category !== undefined && group.categories.includes(line.category)));
/** Deterministically allocates as many complete, non-overlapping bundles as quantities allow. */
export function allocateBundles(lines: PromotionLine[], groups: BundleGroup[], dealPriceMinor: number, repeatable = true): BundleAllocation {
  const remaining = new Map(lines.map(line => [line.id, line.quantity]));
  const bundles: PromotionLine[][] = [];
  while (true) {
    const selected: PromotionLine[] = [];
    for (const group of groups) {
      let need = group.required;
      for (const line of [...lines].sort((a, b) => b.unitPriceMinor - a.unitPriceMinor || a.productId.localeCompare(b.productId) || a.id.localeCompare(b.id))) {
        const available = remaining.get(line.id) ?? 0;
        if (need > 0 && available > 0 && matches(line, group)) { const take = Math.min(need, available); selected.push({ ...line, quantity: take }); need -= take; }
      }
      if (need > 0) { if (!repeatable && bundles.length === 0) return { qualifies: false, lines: [], savingMinor: 0, bundleCount: 0, bundles: [] }; const flat = bundles.flat(); return { qualifies: bundles.length > 0, lines: flat, savingMinor: bundles.reduce((sum, bundle) => sum + Math.max(0, bundle.reduce((n, l) => n + l.unitPriceMinor * l.quantity, 0) - dealPriceMinor), 0), bundleCount: bundles.length, bundles }; }
    }
    for (const line of selected) remaining.set(line.id, (remaining.get(line.id) ?? 0) - line.quantity);
    bundles.push(selected);
    if (!repeatable) break;
  }
  const savingMinor = bundles.reduce((sum, bundle) => sum + Math.max(0, bundle.reduce((n, l) => n + l.unitPriceMinor * l.quantity, 0) - dealPriceMinor), 0);
  return { qualifies: bundles.length > 0, lines: bundles.flat(), savingMinor, bundleCount: bundles.length, bundles };
}
export function allocateBundle(lines: PromotionLine[], groups: BundleGroup[], dealPriceMinor: number) { const result = allocateBundles(lines, groups, dealPriceMinor, false); return { qualifies: result.qualifies, lines: result.bundles[0] ?? [], savingMinor: result.bundles[0] ? result.bundles[0].reduce((n, l) => n + l.unitPriceMinor * l.quantity, 0) - dealPriceMinor > 0 ? result.bundles[0].reduce((n, l) => n + l.unitPriceMinor * l.quantity, 0) - dealPriceMinor : 0 : 0 }; }
export function applyGsnPotOGoldDeal(quantity:number){if(!Number.isInteger(quantity)||quantity<0)throw new Error("invalid_quantity");return Math.floor(quantity/10)*3200+(quantity%10)*400;}
export const GSN_POT_O_GOLD_PROMOTION_NAME = "GSN 10 Meals for £32";
export function gsnPotOGoldPromotion(productIds: string[], startsAt = "1970-01-01T00:00:00.000Z"): PromotionRule {
  return { id: "gsn-pot-o-gold-10-for-32", status: "active", startsAt, effect: "bundle", bundleGroups: [{ required: 10, productIds }], bundlePriceMinor: 3200, repeatable: true, priority: 100, combinable: false };
}
export function applyPromotionRules(lines: PromotionLine[], promotions: PromotionRule[]): { subtotalMinor: number; discountMinor: number; totalMinor: number; applied: Array<{ id: string; savingMinor: number; bundleCount?: number }> } {
  const subtotalMinor = lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
  let discountMinor = 0;
  const applied: Array<{ id: string; savingMinor: number; bundleCount?: number }> = [];
  for (const rule of promotions.filter(item => promotionIsActive(item, new Date()))) {
    if (rule.effect === "bundle" && rule.bundleGroups?.length && rule.bundlePriceMinor !== undefined) {
      const allocation = allocateBundles(lines, rule.bundleGroups, rule.bundlePriceMinor, rule.repeatable ?? true);
      if (allocation.savingMinor > 0) { discountMinor += allocation.savingMinor; applied.push({ id: rule.id, savingMinor: allocation.savingMinor, bundleCount: allocation.bundleCount }); }
    } else {
      const saving = applyPromotion(Math.max(0, subtotalMinor - discountMinor), rule);
      if (saving > 0) { discountMinor += saving; applied.push({ id: rule.id, savingMinor: saving }); }
    }
  }
  discountMinor = Math.min(subtotalMinor, discountMinor);
  return { subtotalMinor, discountMinor, totalMinor: subtotalMinor - discountMinor, applied };
}
export type GoldenCandidateDefinition = { id: string; label: string; lines: PromotionLine[]; percentBasisPoints?: number };
export function deriveGoldenTicketCandidates(definitions: GoldenCandidateDefinition[]): GoldenCandidate[] { return definitions.map(candidate => ({ id: candidate.id, label: candidate.label, eligibleMinor: Math.floor(candidate.lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0) * (candidate.percentBasisPoints ?? 2000) / 10000) })); }
export type AppliedPromotion = { id: string; savingMinor: number; combinable?: boolean; priority?: number; consumedLineIds?: string[] };
/** Applies promotions in priority order; exclusive promotions consume line quantities and cannot overlap. */
export function resolvePromotionStacking(promotions: AppliedPromotion[]) {
  const consumed = new Set<string>(); const applied: AppliedPromotion[] = [];
  for (const promotion of [...promotions].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id))) {
    const overlap = (promotion.consumedLineIds ?? []).some(id => consumed.has(id));
    if (overlap) continue;
    applied.push(promotion);
    if (!promotion.combinable) for (const id of promotion.consumedLineIds ?? []) consumed.add(id);
  }
  return applied;
}
export function goldenTicketEligible(hasQualifyingEntitlement: boolean, redeemedThisMonth: boolean) { return hasQualifyingEntitlement && !redeemedThisMonth; }
export type BalanceTopUpOffer = { id: string; organisationId: string; payMinor: number; spendableMinor: number; title?: string; active: boolean; startsAt: string; endsAt?: string; position?: number };
export function activeBalanceTopUpOffers(offers: BalanceTopUpOffer[], organisationId: string, now = new Date()) { return offers.filter(offer => offer.organisationId === organisationId && offer.active && offer.payMinor > 0 && offer.spendableMinor >= offer.payMinor && new Date(offer.startsAt) <= now && (!offer.endsAt || now < new Date(offer.endsAt))).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.payMinor - b.payMinor || a.id.localeCompare(b.id)); }
export function splitBalanceTopUp(payMinor: number, spendableMinor: number) { if (!Number.isInteger(payMinor) || !Number.isInteger(spendableMinor) || payMinor <= 0 || spendableMinor < payMinor) throw new Error("invalid_balance_offer"); return { cashFundedMinor: payMinor, promotionalBonusMinor: spendableMinor - payMinor, spendableMinor }; }
