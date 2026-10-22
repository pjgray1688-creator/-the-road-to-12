import assert from "node:assert/strict";
import test from "node:test";
import { assertStripeLiveCheckoutEnabled, stripeMerchantForCategory, type StripePaymentCategory } from "../lib/stripe-routing-policy";
import { createStripeCheckoutSession } from "../lib/stripe-join-provider";
import { createStripeCommerceCheckoutSession } from "../lib/stripe-commerce-provider";

test("every Stripe payment category maps to its approved legal entity", () => {
  const routes: Array<[StripePaymentCategory, string]> = [
    ["gym_membership", "madhouse_franchise"],
    ["joining_fee", "madhouse_franchise"],
    ["day_pass", "madhouse_franchise"],
    ["week_pass", "madhouse_franchise"],
    ["transformation_package", "madhouse_products_services"],
    ["personal_training", "madhouse_products_services"],
    ["member_shop", "madhouse_products_services"],
    ["in_gym_purchase", "madhouse_products_services"],
    ["class_booking", "madhouse_products_services"],
    ["glow_zone", "madhouse_products_services"],
    ["other_product_or_service", "madhouse_products_services"],
  ];
  for (const [category, entity] of routes) assert.equal(stripeMerchantForCategory(category), entity, category);
  assert.equal(routes.length, 11);
});

test("live payment creation remains fail-closed independently for both merchants", () => {
  assert.doesNotThrow(() => assertStripeLiveCheckoutEnabled("madhouse_franchise", "test", {}));
  assert.doesNotThrow(() => assertStripeLiveCheckoutEnabled("madhouse_products_services", "test", {}));
  assert.throws(() => assertStripeLiveCheckoutEnabled("madhouse_franchise", "live", {}), /not enabled/);
  assert.throws(() => assertStripeLiveCheckoutEnabled("madhouse_products_services", "live", {}), /not enabled/);
  assert.doesNotThrow(() => assertStripeLiveCheckoutEnabled("madhouse_franchise", "live", { STRIPE_FRANCHISE_LIVE_ENABLED: "true" }));
  assert.doesNotThrow(() => assertStripeLiveCheckoutEnabled("madhouse_products_services", "live", { STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED: "true" }));
  assert.throws(() => assertStripeLiveCheckoutEnabled("madhouse_franchise", "live", { STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED: "true" }), /not enabled/);
});

test("membership and product/service provider paths block live Checkout before network requests", async () => {
  const keys = [
    "NODE_ENV", "STRIPE_FRANCHISE_SECRET_KEY", "STRIPE_FRANCHISE_WEBHOOK_SECRET", "STRIPE_FRANCHISE_ACCOUNT_ID", "STRIPE_FRANCHISE_MODE", "STRIPE_FRANCHISE_LIVE_ENABLED",
    "STRIPE_PRODUCTS_SERVICES_SECRET_KEY", "STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET", "STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID", "STRIPE_PRODUCTS_SERVICES_MODE", "STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED",
  ];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    STRIPE_FRANCHISE_SECRET_KEY: "sk_live_franchisefixture", STRIPE_FRANCHISE_WEBHOOK_SECRET: "whsec_franchise_fixture", STRIPE_FRANCHISE_ACCOUNT_ID: "acct_franchisefixture", STRIPE_FRANCHISE_MODE: "live",
    STRIPE_PRODUCTS_SERVICES_SECRET_KEY: "sk_live_productsfixture", STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET: "whsec_products_fixture", STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID: "acct_productsfixture", STRIPE_PRODUCTS_SERVICES_MODE: "live",
  });
  delete process.env.STRIPE_FRANCHISE_LIVE_ENABLED;
  delete process.env.STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED;
  let networkCalls = 0;
  const fetcher = (async () => { networkCalls++; throw new Error("provider must not be called"); }) as typeof fetch;
  try {
    await assert.rejects(createStripeCheckoutSession({ requestId: "request", generation: 1, membershipProductId: "membership", email: "member@example.test", productName: "Gym membership", checkoutKind: "one_off", joiningFeeMinor: 0, recurringAmountMinor: 1000, upfrontAmountMinor: 1000, currency: "GBP", successUrl: "https://example.test/ok", cancelUrl: "https://example.test/cancel" }, fetcher), /live Stripe Checkout is not enabled/);
    await assert.rejects(createStripeCommerceCheckoutSession({ attemptId: "attempt", orderId: "order", userId: "user", customerEmail: "member@example.test", totalMinor: 1000, currency: "GBP", successUrl: "https://example.test/ok", cancelUrl: "https://example.test/cancel", lines: [{ productId: "product", stripeProductId: "prod_fixture", stripePriceId: "price_fixture", quantity: 1, unitPriceMinor: 1000, currency: "GBP" }] }, fetcher), /live Stripe Checkout is not enabled/);
    assert.equal(networkCalls, 0);
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
