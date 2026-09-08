export type PricingRounding = "exact" | "whole_pound_up" | "marketing_99_up";
export type PricingPolicy = { targetMarginPercent: number; minimumMarginPercent?: number; rounding: PricingRounding };
export type PricingSuggestion = { supplierCostMinor: number; suggestedRetailMinor: number; grossProfitMinor: number; grossMarginPercent: number; markupPercent: number; discountHeadroomMinor: number };
export function suggestRetailPrice(supplierCostMinor: number, policy: PricingPolicy): PricingSuggestion {
  if (!Number.isInteger(supplierCostMinor) || supplierCostMinor <= 0) throw new Error("invalid_supplier_cost");
  if (!Number.isFinite(policy.targetMarginPercent) || policy.targetMarginPercent < 0 || policy.targetMarginPercent >= 100) throw new Error("invalid_margin_policy");
  const floor = Math.ceil(supplierCostMinor / (1 - policy.targetMarginPercent / 100)); const minimum = policy.minimumMarginPercent ?? policy.targetMarginPercent;
  if (minimum < 0 || minimum >= 100) throw new Error("invalid_minimum_margin");
  let retail = floor; if (policy.rounding === "whole_pound_up") retail = Math.ceil(retail / 100) * 100; if (policy.rounding === "marketing_99_up") { const pounds = Math.ceil(retail / 100); retail = pounds * 100 - 1; if (retail < floor) retail += 100; }
  const grossProfitMinor = retail - supplierCostMinor; const grossMarginPercent = grossProfitMinor / retail * 100; const markupPercent = grossProfitMinor / supplierCostMinor * 100; const protectedFloor = Math.ceil(supplierCostMinor / (1 - minimum / 100));
  return { supplierCostMinor, suggestedRetailMinor: retail, grossProfitMinor, grossMarginPercent, markupPercent, discountHeadroomMinor: Math.max(0, retail - protectedFloor) };
}
export function priceAfterDiscountMeetsMargin(supplierCostMinor: number, retailMinor: number, discountMinor: number, minimumMarginPercent: number) {
  if (![supplierCostMinor, retailMinor, discountMinor].every(Number.isInteger) || supplierCostMinor < 0 || retailMinor < 0 || discountMinor < 0 || minimumMarginPercent < 0 || minimumMarginPercent >= 100) return false;
  const net = retailMinor - discountMinor; return net > 0 && (net - supplierCostMinor) / net * 100 >= minimumMarginPercent;
}
