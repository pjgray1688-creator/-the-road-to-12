import type { ClubProduct } from "./club";

/**
 * Products that staff may assign from the member-management flow.
 *
 * Customer-sellable memberships are available to every authorised assigner.
 * Active, non-sellable memberships are staff-assignment products (for example
 * a founding membership) and are available only when the caller already has
 * the membership-assignment capability. Archived products are never offered.
 */
export function membershipProducts(products: ClubProduct[], canAssign: boolean, canAssignStaffOnly = canAssign): ClubProduct[] {
  return products.filter(product => product.kind === "membership" && !product.archivedAt && (product.sellable || (canAssign && canAssignStaffOnly)));
}
