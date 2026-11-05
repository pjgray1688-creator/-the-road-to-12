export type ProductsServicesRoute = {
  category?: unknown;
  active?: unknown;
  stripe_merchant_entity?: unknown;
  sales_channels?: unknown;
};

export type MemberCardEligibilityFailure = "empty" | "inactive_or_missing" | "merchant_route" | "online_channel";

/** Category is deliberately not part of routing: payment merchant assignment
 * and the online sales channel are the authoritative eligibility controls. */
export function memberCardEligibilityFailure(rows: readonly ProductsServicesRoute[]): MemberCardEligibilityFailure | null {
  if (!rows.length) return "empty";
  if (rows.some(row => row.active !== true)) return "inactive_or_missing";
  if (rows.some(row => row.stripe_merchant_entity !== "madhouse_products_services")) return "merchant_route";
  if (rows.some(row => !Array.isArray(row.sales_channels) || !row.sales_channels.includes("online"))) return "online_channel";
  return null;
}
