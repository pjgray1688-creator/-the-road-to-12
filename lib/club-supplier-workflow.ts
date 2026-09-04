import type { ClubCommerceProduct, ClubOrder } from "./club-commerce";
export type FulfilmentState = "in_gym_now" | "available_to_order" | "ordered" | "awaiting_delivery" | "ready_for_collection" | "collected";
export function fulfilmentForProduct(product: ClubCommerceProduct, onHand?: number): FulfilmentState {
  if (product.stockTracked && onHand !== undefined && onHand > 0) return "in_gym_now";
  return "available_to_order";
}
export function paidSupplierDemand(order: ClubOrder, paid: boolean, supplierProductIds: Set<string>) {
  if (!paid || order.status !== "paid") return [];
  return order.items.filter(item => supplierProductIds.has(item.productId)).map(item => ({ orderId: order.id, orderItemId: item.id, productId: item.productId, quantity: item.quantity }));
}
export function collectionReady(quantityRequired: number, quantityReceived: number, quantityAllocated: number) { return quantityRequired > 0 && quantityReceived >= quantityRequired && quantityAllocated >= quantityRequired; }
