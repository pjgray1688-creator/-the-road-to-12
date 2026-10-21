import type { StripeMerchantEntity } from "./stripe-merchant";

export type StripePaymentCategory =
  | "gym_membership"
  | "joining_fee"
  | "day_pass"
  | "week_pass"
  | "transformation_package"
  | "personal_training"
  | "member_shop"
  | "in_gym_purchase"
  | "class_booking"
  | "glow_zone"
  | "other_product_or_service";

const franchiseCategories = new Set<StripePaymentCategory>([
  "gym_membership", "joining_fee", "day_pass", "week_pass",
]);

export function stripeMerchantForCategory(category: StripePaymentCategory): StripeMerchantEntity {
  return franchiseCategories.has(category) ? "madhouse_franchise" : "madhouse_products_services";
}

/** Fail closed for all new live Checkout sessions until that legal entity has
 * completed owner verification and account-specific release checks. */
export function assertStripeLiveCheckoutEnabled(
  entity: StripeMerchantEntity,
  mode: "test" | "live",
  env: Partial<NodeJS.ProcessEnv> = process.env,
) {
  if (mode !== "live") return;
  const flag = entity === "madhouse_franchise"
    ? env.STRIPE_FRANCHISE_LIVE_ENABLED
    : env.STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED;
  if (flag !== "true") throw new Error(`${entity} live Stripe Checkout is not enabled`);
}
