import assert from "node:assert/strict";
import test from "node:test";
import { createStripeClassCheckoutSession, expireStripeClassCheckoutSession, retrieveStripeClassCheckoutSession } from "../lib/stripe-join-provider";

const keys = ["STRIPE_PRODUCTS_SERVICES_SECRET_KEY", "STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET", "STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET", "STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID", "STRIPE_PRODUCTS_SERVICES_MODE", "STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED", "STRIPE_SECRET_KEY"];
const saved = () => Object.fromEntries(keys.map(key => [key, process.env[key]]));
const restore = (values: Record<string, string | undefined>) => { for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value; };
const configure = () => Object.assign(process.env, {
  STRIPE_PRODUCTS_SERVICES_SECRET_KEY: "sk_test_productsservicesfixture",
  STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET: "whsec_products_fixture",
  STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET: "whsec_class_fixture",
  STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID: "acct_productsfixture",
  STRIPE_PRODUCTS_SERVICES_MODE: "test",
});

test("class checkout verifies and uses the configured Products & Services account with exact £10 payload", async () => {
  const original = saved(); configure(); process.env.STRIPE_SECRET_KEY = "sk_test_franchisefixture";
  try {
    const requests: Request[] = [];
    const result = await createStripeClassCheckoutSession({ bookingId: "booking-fixture", sessionId: "session-fixture", amountMinor: 1000, currency: "GBP", successUrl: "https://r12.test/club/classes", cancelUrl: "https://r12.test/club/classes?cancelled=1" }, async (input, init) => {
      const request = new Request(String(input), init); requests.push(request);
      if (request.url.endsWith("/account")) return new Response(JSON.stringify({ id: "acct_productsfixture", company: { name: "Madhouse Products and Services Ltd" } }));
      return new Response(JSON.stringify({ id: "cs_test_fixture", url: "https://checkout.stripe.test/session", mode: "payment", status: "open", payment_status: "unpaid", amount_total: 1000, payment_intent: "pi_test_fixture", customer: null, subscription: null }));
    });
    assert.equal(result.amount_total, 1000);
    assert.equal(new Headers(requests[0].headers).get("authorization"), "Bearer sk_test_productsservicesfixture");
    assert.equal(new Headers(requests[1].headers).get("authorization"), "Bearer sk_test_productsservicesfixture");
    assert.equal(new Headers(requests[1].headers).get("idempotency-key"), "r12-madhouse-class-booking-fixture");
    const body = new URLSearchParams(await requests[1].text());
    assert.equal(body.get("line_items[0][price_data][unit_amount]"), "1000");
    assert.equal(body.get("line_items[0][price_data][currency]"), "gbp");
    assert.equal(body.get("metadata[booking_id]"), "booking-fixture");
  } finally { restore(original); }
});

test("class checkout never falls back to Franchise and rejects wrong account or unapproved live mode", async () => {
  const original = saved(); configure(); process.env.STRIPE_SECRET_KEY = "sk_test_franchisefixture";
  try {
    process.env.STRIPE_PRODUCTS_SERVICES_ACCOUNT_ID = "acct_expected";
    await assert.rejects(() => createStripeClassCheckoutSession({ bookingId: "b", sessionId: "s", amountMinor: 1000, currency: "GBP", successUrl: "https://r12.test", cancelUrl: "https://r12.test" }, async url => String(url).endsWith("/account") ? new Response(JSON.stringify({ id: "acct_wrong" })) : new Response("{}")), /account identity does not match configuration/);
    process.env.STRIPE_PRODUCTS_SERVICES_SECRET_KEY = "sk_live_productsfixture";
    process.env.STRIPE_PRODUCTS_SERVICES_MODE = "live";
    await assert.rejects(() => createStripeClassCheckoutSession({ bookingId: "b", sessionId: "s", amountMinor: 1000, currency: "GBP", successUrl: "https://r12.test", cancelUrl: "https://r12.test" }, async () => { throw new Error("must not call provider"); }), /live Stripe Checkout is not enabled/);
  } finally { restore(original); }
});

test("class session reads and expiration keep account binding while remaining available behind the live checkout gate", async () => {
  const original = saved(); configure();
  process.env.STRIPE_PRODUCTS_SERVICES_SECRET_KEY = "rk_live_productsfixture";
  process.env.STRIPE_PRODUCTS_SERVICES_MODE = "live";
  delete process.env.STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED;
  try {
    const calls: Array<{ path: string; method: string }> = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ path: String(url).replace("https://api.stripe.com/v1", ""), method: init?.method ?? "GET" });
      if (String(url).endsWith("/account")) return Response.json({ id: "acct_productsfixture", company: { name: "Madhouse Products and Services Ltd" } });
      if (String(url).includes("/expire")) return Response.json({ id: "cs_live_fixture", status: "expired" });
      return Response.json({ id: "cs_live_fixture", status: "open" });
    }) as typeof fetch;
    assert.equal((await retrieveStripeClassCheckoutSession("cs_live_fixture", fetcher)).status, "open");
    assert.equal((await expireStripeClassCheckoutSession("cs_live_fixture", fetcher)).status, "expired");
    assert.deepEqual(calls, [
      { path: "/account", method: "GET" }, { path: "/checkout/sessions/cs_live_fixture", method: "GET" },
      { path: "/account", method: "GET" }, { path: "/checkout/sessions/cs_live_fixture/expire", method: "POST" },
    ]);
  } finally { restore(original); }
});
