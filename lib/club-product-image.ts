import type { ClubCommerceProduct } from "./club-commerce";

/** Resolve the current catalogue-owned image consistently for both Club shops. */
export function productImageUrl(product: ClubCommerceProduct | undefined) {
  const supplierManaged = product?.supplierReference?.startsWith("supplier_product:") === true;
  const value = supplierManaged
    ? product?.variantImageReference ?? product?.media?.variantImageReference ?? product?.media?.parentImageReference ?? product?.media?.url
    : product?.media?.url ?? product?.media?.variantImageReference ?? product?.media?.parentImageReference ?? product?.variantImageReference;
  return typeof value === "string" && value.trim() ? value : undefined;
}
