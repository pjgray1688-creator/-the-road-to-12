export type ShelfAllocation = { readyAt: Date; status: "ready_for_collection" | "collected" | string; locationId: string };
export function shelfCheckEligible(allocation: ShelfAllocation, now: Date) {
  return allocation.status === "ready_for_collection" && now.getTime() - allocation.readyAt.getTime() >= 3 * 86_400_000;
}
export function reminderKey(orderId: string) { return `collection_shelf_reminder:${orderId}`; }
export type RemovalReason = "staff_consumption" | "complimentary" | "promotion_sample" | "damaged" | "waste" | "other";
export function stockRemovalEffect(quantity: number, reason: RemovalReason) { return { quantityDelta: -Math.max(0, Math.floor(quantity)), reason }; }
