import assert from "node:assert/strict";
import test from "node:test";
import { createStripeClassCheckoutSession } from "../lib/stripe-join-provider";

test("class checkout uses the dedicated Products & Services test account and exact £10 payload", async () => {
  const originalClassKey = process.env.STRIPE_PRODUCTS_SERVICES_SECRET_KEY;
  const originalJoinKey = process.env.STRIPE_SECRET_KEY;
  const originalLiveFlag = process.env.MADHOUSE_CLASS_STRIPE_LIVE_ENABLED;
  process.env.STRIPE_PRODUCTS_SERVICES_SECRET_KEY = "sk_test_products_services_fixture";
  process.env.STRIPE_SECRET_KEY = "sk_test_franchise_fixture";
  delete process.env.MADHOUSE_CLASS_STRIPE_LIVE_ENABLED;
  try {
    let request: Request | undefined;
    const result = await createStripeClassCheckoutSession({ bookingId: "booking-fixture", sessionId: "session-fixture", amountMinor: 1000, currency: "GBP", successUrl: "https://r12.test/club/classes", cancelUrl: "https://r12.test/club/classes?cancelled=1" }, async (input, init) => {
      request = new Request(String(input), init);
      return new Response(JSON.stringify({ id: "cs_test_fixture", url: "https://checkout.stripe.test/session", status: "open", payment_status: "unpaid", amount_total: 1000, payment_intent: "pi_test_fixture" }), { status: 200 });
    });
    assert.equal(result.amount_total, 1000);
    assert.equal(new Headers(request?.headers).get("authorization"), "Bearer sk_test_products_services_fixture");
    assert.equal(new Headers(request?.headers).get("idempotency-key"), "r12-madhouse-class-booking-fixture");
    const body = new URLSearchParams(await request!.text());
    assert.equal(body.get("line_items[0][price_data][unit_amount]"), "1000");
    assert.equal(body.get("line_items[0][price_data][currency]"), "gbp");
    assert.equal(body.get("metadata[booking_id]"), "booking-fixture");
  } finally {
    if (originalClassKey === undefined) delete process.env.STRIPE_PRODUCTS_SERVICES_SECRET_KEY; else process.env.STRIPE_PRODUCTS_SERVICES_SECRET_KEY = originalClassKey;
    if (originalJoinKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = originalJoinKey;
    if (originalLiveFlag === undefined) delete process.env.MADHOUSE_CLASS_STRIPE_LIVE_ENABLED; else process.env.MADHOUSE_CLASS_STRIPE_LIVE_ENABLED = originalLiveFlag;
  }
});

test("class checkout never falls back to the Franchise join key or accepts live mode by default", async () => {
  const originalClassKey = process.env.STRIPE_PRODUCTS_SERVICES_SECRET_KEY;
  const originalJoinKey = process.env.STRIPE_SECRET_KEY;
  const originalLiveFlag = process.env.MADHOUSE_CLASS_STRIPE_LIVE_ENABLED;
  process.env.STRIPE_SECRET_KEY = "sk_test_franchise_fixture";
  delete process.env.STRIPE_PRODUCTS_SERVICES_SECRET_KEY;
  delete process.env.MADHOUSE_CLASS_STRIPE_LIVE_ENABLED;
  try {
    await assert.rejects(() => createStripeClassCheckoutSession({ bookingId: "booking-fixture", sessionId: "session-fixture", amountMinor: 1000, currency: "GBP", successUrl: "https://r12.test/success", cancelUrl: "https://r12.test/cancel" }, async () => { throw new Error("must not call provider"); }), /Products & Services class payments are not configured/);
    process.env.STRIPE_PRODUCTS_SERVICES_SECRET_KEY = "sk_live_products_services_fixture";
    await assert.rejects(() => createStripeClassCheckoutSession({ bookingId: "booking-fixture", sessionId: "session-fixture", amountMinor: 1000, currency: "GBP", successUrl: "https://r12.test/success", cancelUrl: "https://r12.test/cancel" }, async () => { throw new Error("must not call provider"); }), /restricted to Stripe test mode/);
  } finally {
    if (originalClassKey === undefined) delete process.env.STRIPE_PRODUCTS_SERVICES_SECRET_KEY; else process.env.STRIPE_PRODUCTS_SERVICES_SECRET_KEY = originalClassKey;
    if (originalJoinKey === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = originalJoinKey;
    if (originalLiveFlag === undefined) delete process.env.MADHOUSE_CLASS_STRIPE_LIVE_ENABLED; else process.env.MADHOUSE_CLASS_STRIPE_LIVE_ENABLED = originalLiveFlag;
  }
});
