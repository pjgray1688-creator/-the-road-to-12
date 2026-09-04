export type ShelfAllocation = { readyAt: Date; status: "ready_for_collection" | "collected" | string; locationId: string };
export function shelfCheckEligible(allocation: ShelfAllocation, now: Date) {
  return allocation.status === "ready_for_collection" && now.getTime() - allocation.readyAt.getTime() >= 3 * 86_400_000;
}
export function reminderKey(orderId: string) { return `collection_shelf_reminder:${orderId}`; }
export function reminderAllowed(lastReminderAt: Date | undefined, now: Date, cooldownMs = 24 * 60 * 60 * 1000) { return !lastReminderAt || now.getTime() - lastReminderAt.getTime() >= cooldownMs; }
export function discountAmount(kind: "percentage" | "fixed" | "comp", subtotalMinor: number, valueMinor?: number, percent?: number) {
  if (!Number.isInteger(subtotalMinor) || subtotalMinor < 0) throw new Error("Invalid subtotal");
  if (kind === "comp") return subtotalMinor;
  if (kind === "percentage") { if (percent === undefined || percent < 0 || percent > 100 || valueMinor !== undefined) throw new Error("Invalid percentage"); return Math.round(subtotalMinor * percent / 100); }
  if (valueMinor === undefined || valueMinor < 0 || valueMinor > subtotalMinor || percent !== undefined) throw new Error("Invalid fixed discount");
  return valueMinor;
}
export type RemovalReason = "staff_consumption" | "complimentary" | "promotion_sample" | "damaged" | "waste" | "other";
export function stockRemovalEffect(quantity: number, reason: RemovalReason) { return { quantityDelta: -Math.max(0, Math.floor(quantity)), reason }; }
