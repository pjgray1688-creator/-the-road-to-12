import type { ClubCommerceProduct } from "./club-commerce";

/** Resolve the current catalogue-owned image consistently for both Club shops. */
export function productImageUrl(product: ClubCommerceProduct | undefined) {
  const supplierManaged = product?.supplierReference?.startsWith("supplier_product:") === true;
  const value = supplierManaged
    ? product?.variantImageReference ?? product?.media?.variantImageReference ?? product?.media?.parentImageReference ?? product?.media?.url
    : product?.media?.url ?? product?.media?.variantImageReference ?? product?.media?.parentImageReference ?? product?.variantImageReference;
  if (typeof value === "string" && value.trim()) return value;
  const name = product?.name.trim().toLocaleLowerCase() ?? "";
  if (/^10\s*pt\s*session\s*block\b/.test(name)) return "/madhouse-shop/10-pt-session-block.svg";
  if (/^transformation\s+bronze\b/.test(name)) return "/madhouse-shop/transformation-bronze.svg";
  if (/^transformation\s+silver\b/.test(name)) return "/madhouse-shop/transformation-silver.svg";
  if (/^transformation\s+gold\b/.test(name)) return "/madhouse-shop/transformation-gold.svg";
  return undefined;
}
