export type PricingTarget = { kind: "markup" | "margin"; percent: number };
export type RoundingMode = "exact" | "5p" | "10p" | "50p" | "£1";

export function pricingMath(costMinor: number, sellMinor: number, vatRatePercent = 0, feePercent = 0) {
  if (!Number.isInteger(costMinor) || costMinor < 0 || !Number.isInteger(sellMinor) || sellMinor < 0) return undefined;
  const exVat = Math.round(sellMinor / (1 + vatRatePercent / 100));
  const profitMinor = exVat - costMinor;
  return { profitMinor, markupPercent: costMinor ? profitMinor / costMinor * 100 : undefined, marginPercent: exVat ? profitMinor / exVat * 100 : undefined, feeMinor: Math.round(sellMinor * feePercent / 100) };
}

export function recommendedPriceMinor(costMinor: number, target: PricingTarget, rounding: RoundingMode = "exact", vatRatePercent = 0, feePercent = 0) {
  if (!Number.isInteger(costMinor) || costMinor < 0 || !Number.isFinite(target.percent) || target.percent < 0) return undefined;
  const base = target.kind === "markup" ? costMinor * (1 + target.percent / 100) : costMinor / (1 - target.percent / 100);
  if (!Number.isFinite(base)) return undefined;
  const gross = base * (1 + vatRatePercent / 100) * (1 + feePercent / 100);
  const increment = rounding === "5p" ? 5 : rounding === "10p" ? 10 : rounding === "50p" ? 50 : rounding === "£1" ? 100 : 1;
  return Math.ceil(gross / increment) * increment;
}
