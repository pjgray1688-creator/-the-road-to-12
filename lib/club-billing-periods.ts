export type BillingFrequency = "weekly" | "monthly" | "quarterly" | "annual" | "other";

/** Calendar-aware advancement used by the recurring arrangement. */
export function nextBillingDate(date: Date, frequency: BillingFrequency, explicitNext?: Date | null) {
  if (frequency === "other") return explicitNext ?? null;
  const next = new Date(date);
  if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  if (frequency === "monthly" || frequency === "quarterly") {
    const months = frequency === "monthly" ? 1 : 3;
    const day = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
  }
  if (frequency === "annual") next.setUTCFullYear(next.getUTCFullYear() + 1);
  return next;
}

export function billingPeriodKey(date: Date) { return date.toISOString(); }
