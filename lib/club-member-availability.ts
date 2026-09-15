import type { ClubCommerceProduct } from "./club-commerce";

export type MemberAvailabilityState = "IN_GYM" | "OTHER_GYM" | "SUPPLIER_ORDER" | "UNAVAILABLE";

/** Resolves customer-visible fulfilment without exposing operational stock values. */
export function resolveMemberProductAvailability(input: {
  availableLocalQuantity?: number | null;
  supplierOrderable: boolean;
}): MemberAvailabilityState {
  if ((input.availableLocalQuantity ?? 0) > 0) return "IN_GYM";
  return input.supplierOrderable ? "SUPPLIER_ORDER" : "UNAVAILABLE";
}

export function memberAvailabilityLabel(state: MemberAvailabilityState): string {
  return state === "IN_GYM" ? "In Gym Now" : state === "OTHER_GYM" ? "Available at another gym" : state === "SUPPLIER_ORDER" ? "Available to Order" : "Unavailable";
}

export function supplierOrderable(product: ClubCommerceProduct): boolean {
  if (product.supplierAvailabilityStatus) return product.supplierMemberOrderable !== false && product.supplierAvailabilityStatus === "available";
  // A supplier reference identifies provenance, not current availability.
  // Exact supplier status must be present before offering supplier ordering.
  return false;
}
