export type PricingTarget = { kind: "markup" | "margin"; percent: number };
export type RoundingMode = "exact" | "5p" | "10p" | "50p" | "£1";

function validRate(value: number) { return Number.isFinite(value) && value >= 0 && value < 100; }

export function inclVatToExVatMinor(inclMinor: number, vatRatePercent = 0) {
  if (!Number.isInteger(inclMinor) || inclMinor < 0 || !validRate(vatRatePercent)) return undefined;
  return Math.round(inclMinor / (1 + vatRatePercent / 100));
}

export function exVatToInclVatMinor(exMinor: number, vatRatePercent = 0) {
  if (!Number.isInteger(exMinor) || exMinor < 0 || !validRate(vatRatePercent)) return undefined;
  return Math.round(exMinor * (1 + vatRatePercent / 100));
}

export function grossUpForMerchantFeeMinor(requiredNetMinor: number, feePercent = 0) {
  if (!Number.isInteger(requiredNetMinor) || requiredNetMinor < 0 || !validRate(feePercent)) return undefined;
  return Math.ceil(requiredNetMinor / (1 - feePercent / 100));
}

export function pricingMath(costMinor: number, sellMinor: number, vatRatePercent = 0, feePercent = 0) {
  if (!Number.isInteger(costMinor) || costMinor < 0 || !Number.isInteger(sellMinor) || sellMinor < 0 || !validRate(vatRatePercent) || !validRate(feePercent)) return undefined;
  const exVat = inclVatToExVatMinor(sellMinor, vatRatePercent)!;
  const feeMinor = Math.round(sellMinor * feePercent / 100);
  const netRevenueMinor = sellMinor - feeMinor;
  const profitMinor = exVat - costMinor;
  const profitAfterFeeMinor = netRevenueMinor - costMinor;
  return { sellMinor, exVatMinor: exVat, feeMinor, netRevenueMinor, costMinor, profitMinor, profitAfterFeeMinor, markupPercent: costMinor ? profitMinor / costMinor * 100 : undefined, marginPercent: exVat ? profitMinor / exVat * 100 : undefined, marginAfterFeePercent: netRevenueMinor ? profitAfterFeeMinor / netRevenueMinor * 100 : undefined };
}

export function recommendedPriceMinor(costMinor: number, target: PricingTarget, rounding: RoundingMode = "exact", vatRatePercent = 0, feePercent = 0) {
  if (!Number.isInteger(costMinor) || costMinor < 0 || !Number.isFinite(target.percent) || target.percent < 0) return undefined;
  const base = target.kind === "markup" ? costMinor * (1 + target.percent / 100) : costMinor / (1 - target.percent / 100);
  if (!Number.isFinite(base)) return undefined;
  if (!validRate(vatRatePercent) || !validRate(feePercent)) return undefined;
  const grossExFee = Math.ceil(base * (1 + vatRatePercent / 100));
  const gross = grossUpForMerchantFeeMinor(grossExFee, feePercent);
  if (gross === undefined) return undefined;
  const increment = rounding === "5p" ? 5 : rounding === "10p" ? 10 : rounding === "50p" ? 50 : rounding === "£1" ? 100 : 1;
  return Math.ceil(gross / increment) * increment;
}
