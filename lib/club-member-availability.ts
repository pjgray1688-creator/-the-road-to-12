import type { ClubCommerceProduct } from "./club-commerce";

export type MemberAvailabilityState = "IN_GYM" | "SUPPLIER_ORDER" | "UNAVAILABLE";

/** Resolves customer-visible fulfilment without exposing operational stock values. */
export function resolveMemberProductAvailability(input: {
  availableLocalQuantity?: number | null;
  supplierOrderable: boolean;
}): MemberAvailabilityState {
  if ((input.availableLocalQuantity ?? 0) > 0) return "IN_GYM";
  return input.supplierOrderable ? "SUPPLIER_ORDER" : "UNAVAILABLE";
}

export function memberAvailabilityLabel(state: MemberAvailabilityState): string {
  return state === "IN_GYM" ? "In Gym Now" : state === "SUPPLIER_ORDER" ? "Available to Order" : "Unavailable";
}

export function supplierOrderable(product: ClubCommerceProduct): boolean {
  return Boolean(product.supplierReference);
}
