import assert from "node:assert/strict";
import test from "node:test";
import { createStripeClassCheckoutSession } from "../lib/stripe-join-provider";

const keys = ["STRIPE_PRODUCTS_SERVICES_SECRET_KEY", "STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET", "STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET", "STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID", "STRIPE_PRODUCTS_SERVICES_MODE", "STRIPE_SECRET_KEY", "MADHOUSE_CLASS_STRIPE_LIVE_ENABLED"];
const saved = () => Object.fromEntries(keys.map(key => [key, process.env[key]]));
const restore = (values: Record<string, string | undefined>) => { for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value; };
const configure = () => Object.assign(process.env, {
  STRIPE_PRODUCTS_SERVICES_SECRET_KEY: "sk_test_products_services_fixture",
  STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET: "whsec_products_fixture",
  STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET: "whsec_class_fixture",
  STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID: "acct_products_fixture",
  STRIPE_PRODUCTS_SERVICES_MODE: "test",
});

test("class checkout verifies and uses the configured Products & Services account with exact £10 payload", async () => {
  const original = saved(); configure(); process.env.STRIPE_SECRET_KEY = "sk_test_franchise_fixture"; delete process.env.MADHOUSE_CLASS_STRIPE_LIVE_ENABLED;
  try {
    const requests: Request[] = [];
    const result = await createStripeClassCheckoutSession({ bookingId: "booking-fixture", sessionId: "session-fixture", amountMinor: 1000, currency: "GBP", successUrl: "https://r12.test/club/classes", cancelUrl: "https://r12.test/club/classes?cancelled=1" }, async (input, init) => {
      const request = new Request(String(input), init); requests.push(request);
      if (request.url.endsWith("/account")) return new Response(JSON.stringify({ id: "acct_products_fixture" }));
      return new Response(JSON.stringify({ id: "cs_test_fixture", url: "https://checkout.stripe.test/session", mode: "payment", status: "open", payment_status: "unpaid", amount_total: 1000, payment_intent: "pi_test_fixture", customer: null, subscription: null }));
    });
    assert.equal(result.amount_total, 1000);
    assert.equal(new Headers(requests[0].headers).get("authorization"), "Bearer sk_test_products_services_fixture");
    assert.equal(new Headers(requests[1].headers).get("authorization"), "Bearer sk_test_products_services_fixture");
    assert.equal(new Headers(requests[1].headers).get("idempotency-key"), "r12-madhouse-class-booking-fixture");
    const body = new URLSearchParams(await requests[1].text());
    assert.equal(body.get("line_items[0][price_data][unit_amount]"), "1000");
    assert.equal(body.get("line_items[0][price_data][currency]"), "gbp");
    assert.equal(body.get("metadata[booking_id]"), "booking-fixture");
  } finally { restore(original); }
});

test("class checkout never falls back to Franchise and rejects wrong account or unapproved live mode", async () => {
  const original = saved(); configure(); process.env.STRIPE_SECRET_KEY = "sk_test_franchise_fixture";
  try {
    process.env.STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID = "acct_expected";
    await assert.rejects(() => createStripeClassCheckoutSession({ bookingId: "b", sessionId: "s", amountMinor: 1000, currency: "GBP", successUrl: "https://r12.test", cancelUrl: "https://r12.test" }, async url => String(url).endsWith("/account") ? new Response(JSON.stringify({ id: "acct_wrong" })) : new Response("{}")), /not for Madhouse Products and Services/);
    process.env.STRIPE_PRODUCTS_SERVICES_SECRET_KEY = "sk_live_products_fixture";
    process.env.STRIPE_PRODUCTS_SERVICES_MODE = "live";
    delete process.env.MADHOUSE_CLASS_STRIPE_LIVE_ENABLED;
    await assert.rejects(() => createStripeClassCheckoutSession({ bookingId: "b", sessionId: "s", amountMinor: 1000, currency: "GBP", successUrl: "https://r12.test", cancelUrl: "https://r12.test" }, async () => { throw new Error("must not call provider"); }), /restricted to Stripe test mode/);
  } finally { restore(original); }
});
