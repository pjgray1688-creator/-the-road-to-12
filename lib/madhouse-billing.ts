export type MadhouseCheckoutKind = "free" | "monthly_recurring" | "day_pass" | "week_pass" | "annual_one_off" | "one_off";

export function madhouseCheckoutKind(product: { priceMinor: number; billing: string; durationDays?: number }): MadhouseCheckoutKind {
  if (product.priceMinor === 0) return "free";
  if (product.billing === "recurring") return "monthly_recurring";
  if (product.durationDays === 1) return "day_pass";
  if (product.durationDays === 7) return "week_pass";
  if ((product.durationDays ?? 0) >= 365) return "annual_one_off";
  return "one_off";
}

export function nextMonthlyAnniversary(from: Date, anchorDay = from.getUTCDate()): Date {
  const year = from.getUTCMonth() === 11 ? from.getUTCFullYear() + 1 : from.getUTCFullYear();
  const month = (from.getUTCMonth() + 1) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(anchorDay, lastDay), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()));
}

export function paidThrough(start: Date, durationDays: number): Date {
  return new Date(start.getTime() + durationDays * 86_400_000);
}

export function annualRenewalReminderDates(expiry: Date): Date[] {
  const targetMonth = expiry.getUTCMonth() === 0 ? 11 : expiry.getUTCMonth() - 1;
  const targetYear = expiry.getUTCMonth() === 0 ? expiry.getUTCFullYear() - 1 : expiry.getUTCFullYear();
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const month = new Date(Date.UTC(targetYear, targetMonth, Math.min(expiry.getUTCDate(), lastDay), expiry.getUTCHours(), expiry.getUTCMinutes(), expiry.getUTCSeconds(), expiry.getUTCMilliseconds()));
  return [month, new Date(expiry.getTime() - 7 * 86_400_000), new Date(expiry.getTime() - 3 * 86_400_000)];
}

export function recurringGraceEligible(input: { billing: string; frequency?: string }) {
  return input.billing === "recurring" && input.frequency === "monthly";
}
