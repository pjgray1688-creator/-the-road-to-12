import assert from "node:assert/strict";
import test from "node:test";
import { capturePayPalOrder, createPayPalOrder, readPayPalProviderConfig, verifyPayPalWebhook } from "../lib/paypal-provider";

const env = {
  NODE_ENV: "test",
  PAYPAL_ENVIRONMENT: "sandbox",
  PAYPAL_CLIENT_ID: "client-test",
  PAYPAL_CLIENT_SECRET: "server-secret-test",
  PAYPAL_WEBHOOK_ID: "webhook-test",
} as NodeJS.ProcessEnv;

function tokenResponse() { return new Response(JSON.stringify({ access_token: "access-test" })); }

test("PayPal configuration requires server credentials, webhook verification and explicit environment", () => {
  assert.deepEqual(readPayPalProviderConfig(env), {
    clientId: "client-test", clientSecret: "server-secret-test", webhookId: "webhook-test", environment: "sandbox",
  });
  assert.throws(() => readPayPalProviderConfig({ ...env, PAYPAL_WEBHOOK_ID: "" }), /credentials are incomplete/);
  assert.throws(() => readPayPalProviderConfig({ ...env, PAYPAL_ENVIRONMENT: "" }), /PAYPAL_ENVIRONMENT/);
});

test("order creation uses the saved amount, approved merchant and stable provider idempotency key", async () => {
  const requests: Request[] = [];
  const order = await createPayPalOrder({
    orderId: "order-1234567890123456", merchantId: "merchant-test", amountMinor: 25000,
    currency: "GBP", description: "madhouse transformation bronze", returnUrl: "https://r12.test/complete",
    cancelUrl: "https://r12.test/cancel",
  }, { env, fetcher: async (input, init) => {
    const request = new Request(String(input), init); requests.push(request);
    if (request.url.endsWith("/v1/oauth2/token")) return tokenResponse();
    assert.equal(request.url, "https://api-m.sandbox.paypal.com/v2/checkout/orders");
    assert.equal(request.headers.get("authorization"), "Bearer access-test");
    assert.equal(request.headers.get("paypal-request-id"), "r12-paypal-order-1234567890123456");
    const body = await request.json() as { purchase_units: Array<{ amount: { value: string; currency_code: string }; payee: { merchant_id: string } }> };
    assert.equal(body.purchase_units[0].amount.value, "250.00");
    assert.equal(body.purchase_units[0].amount.currency_code, "GBP");
    assert.equal(body.purchase_units[0].payee.merchant_id, "merchant-test");
    return Response.json({
      id: "provider-order-1234", status: "CREATED", purchase_units: [{
        custom_id: "order-1234567890123456", reference_id: "order-1234567890123456",
        amount: { currency_code: "GBP", value: "250.00" }, payee: { merchant_id: "merchant-test" },
      }], links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=provider-order-1234" }],
    });
  } });
  assert.equal(order.status, "CREATED");
  assert.equal(requests.length, 2);
  await assert.rejects(() => createPayPalOrder({
    orderId: "order-1234567890123456", merchantId: "merchant-test", amountMinor: 25000,
    currency: "GBP", description: "fixture", returnUrl: "https://r12.test/complete", cancelUrl: "https://r12.test/cancel",
  }, { env, fetcher: async (input, init) => {
    const request = new Request(String(input), init);
    return request.url.endsWith("/v1/oauth2/token") ? tokenResponse() : Response.json({
      id: "provider-order-1234", status: "CREATED", purchase_units: [{ custom_id: "order-1234567890123456", amount: { currency_code: "GBP", value: "2.50" }, payee: { merchant_id: "merchant-test" } }],
    });
  } }), /does not match/);
});

test("capture confirms provider state, amount, currency and merchant before reporting paid", async () => {
  let captureRequest: Request | undefined;
  const result = await capturePayPalOrder({ providerOrderId: "provider-order-1234", orderId: "order-1234567890123456", merchantId: "merchant-test", amountMinor: 1000 }, {
    env, fetcher: async (input, init) => {
      const request = new Request(String(input), init);
      if (request.url.endsWith("/v1/oauth2/token")) return tokenResponse();
      captureRequest = request;
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("paypal-request-id"), "r12-paypal-capture-order-1234567890123456");
      return Response.json({ id: "provider-order-1234", status: "COMPLETED", purchase_units: [{
        custom_id: "order-1234567890123456", reference_id: "order-1234567890123456", amount: { currency_code: "GBP", value: "10.00" },
        payee: { merchant_id: "merchant-test" }, payments: { captures: [{ id: "capture-123456", status: "COMPLETED", amount: { currency_code: "GBP", value: "10.00" } }] },
      }] });
    },
  });
  assert.ok(captureRequest);
  assert.equal(result.capture.id, "capture-123456");
  await assert.rejects(() => capturePayPalOrder({ providerOrderId: "provider-order-1234", orderId: "order-1234567890123456", merchantId: "merchant-test", amountMinor: 1000 }, {
    env, fetcher: async (input, init) => {
      const request = new Request(String(input), init);
      if (request.url.endsWith("/v1/oauth2/token")) return tokenResponse();
      return Response.json({ status: "PENDING", purchase_units: [] });
    },
  }), /has not been verified/);
});

test("webhook verification asks PayPal to validate its signed transmission", async () => {
  const headers = new Headers({
    "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert/test",
    "paypal-transmission-id": "transmission-1", "paypal-transmission-sig": "signature", "paypal-transmission-time": "2026-10-21T10:00:00Z",
  });
  const event = { id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED" };
  let verifyBody: Record<string, unknown> | undefined;
  const result = await verifyPayPalWebhook({ headers, event }, { env, fetcher: async (input, init) => {
    const request = new Request(String(input), init);
    if (request.url.endsWith("/v1/oauth2/token")) return tokenResponse();
    assert.equal(request.url, "https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    verifyBody = await request.json() as Record<string, unknown>;
    return Response.json({ verification_status: "SUCCESS" });
  } });
  assert.equal(result, true);
  assert.equal(verifyBody?.webhook_id, "webhook-test");
  assert.deepEqual(verifyBody?.webhook_event, event);
  assert.equal(await verifyPayPalWebhook({ headers: new Headers(), event }, { env, fetcher: async () => { throw new Error("must not call without headers"); } }), false);
});
