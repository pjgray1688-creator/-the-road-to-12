export type PromotionLine = { id: string; productId: string; category?: string; unitPriceMinor: number; quantity: number };
export type PromotionRule = { id: string; status: "draft"|"active"|"paused"|"expired"; startsAt: string; endsAt?: string; locationIds?: string[]; effect: "percentage"|"fixed"|"fixed_price"; valueMinor?: number; percentageBasisPoints?: number; priority?: number; combinable?: boolean };
export function promotionIsActive(rule: PromotionRule, now: Date, locationId?: string) { return rule.status === "active" && new Date(rule.startsAt) <= now && (!rule.endsAt || now < new Date(rule.endsAt)) && (!rule.locationIds?.length || (locationId ? rule.locationIds.includes(locationId) : false)); }
export function applyPromotion(subtotalMinor: number, rule: PromotionRule): number { const saving = rule.effect === "percentage" ? Math.floor(subtotalMinor * Math.max(0, Math.min(10000, rule.percentageBasisPoints ?? 0)) / 10000) : rule.effect === "fixed_price" ? Math.max(0, subtotalMinor - (rule.valueMinor ?? 0)) : Math.max(0, rule.valueMinor ?? 0); return Math.min(subtotalMinor, saving); }
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
      for (const line of lines) {
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
export type GoldenCandidateDefinition = { id: string; label: string; lines: PromotionLine[]; percentBasisPoints?: number };
export function deriveGoldenTicketCandidates(definitions: GoldenCandidateDefinition[]): GoldenCandidate[] { return definitions.map(candidate => ({ id: candidate.id, label: candidate.label, eligibleMinor: Math.floor(candidate.lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0) * (candidate.percentBasisPoints ?? 2000) / 10000) })); }
