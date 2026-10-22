import { readStripeMerchantConfig, stripeMerchantRequest, verifyStripeMerchantAccount } from "./stripe-merchant";
import { assertStripeLiveCheckoutEnabled, stripeMerchantForCategory } from "./stripe-routing-policy";

export type StripeCommercePrice = {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  product: string | { id: string };
};

export type StripeCommerceSession = {
  id: string;
  url: string | null;
  mode: "payment" | "subscription";
  status: "open" | "complete" | "expired" | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  payment_intent: string | { id: string } | null;
  customer: string | { id: string } | null;
  metadata?: Record<string, string>;
};

export function retrieveStripeCommercePrice(id: string, fetcher?: typeof fetch) {
  return (async () => { await verifyStripeMerchantAccount("madhouse_products_services", fetcher); return stripeMerchantRequest<StripeCommercePrice>("madhouse_products_services", `/prices/${encodeURIComponent(id)}`, {}, fetcher); })();
}

export function retrieveStripeCommerceCharge(id: string, fetcher?: typeof fetch) {
  return (async () => { await verifyStripeMerchantAccount("madhouse_products_services", fetcher); return stripeMerchantRequest<{ id: string; payment_intent: string | { id: string }; customer: string | null; amount_refunded: number; amount: number; currency: string; metadata?: Record<string, string> }>("madhouse_products_services", `/charges/${encodeURIComponent(id)}`, {}, fetcher); })();
}

export function retrieveStripeCommercePaymentIntent(id: string, fetcher?: typeof fetch) {
  return (async () => { await verifyStripeMerchantAccount("madhouse_products_services", fetcher); return stripeMerchantRequest<{ id: string; metadata?: Record<string, string> }>("madhouse_products_services", `/payment_intents/${encodeURIComponent(id)}`, {}, fetcher); })();
}

export async function retrieveStripeCommerceCheckoutSession(id: string, fetcher?: typeof fetch) {
  await verifyStripeMerchantAccount("madhouse_products_services", fetcher);
  return stripeMerchantRequest<StripeCommerceSession>("madhouse_products_services", `/checkout/sessions/${encodeURIComponent(id)}`, {}, fetcher);
}

export function expireStripeCommerceCheckoutSession(id: string, fetcher?: typeof fetch) {
  return (async () => { await verifyStripeMerchantAccount("madhouse_products_services", fetcher); return stripeMerchantRequest<StripeCommerceSession>("madhouse_products_services", `/checkout/sessions/${encodeURIComponent(id)}/expire`, { method: "POST" }, fetcher); })();
}

export function createStripeCommerceCheckoutSession(input: {
  attemptId: string;
  orderId: string;
  userId: string;
  customerEmail: string;
  totalMinor: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  lines: Array<{ productId: string; stripeProductId: string; stripePriceId: string; quantity: number; unitPriceMinor: number; currency: string }>;
}, fetcher?: typeof fetch) {
  if (!input.attemptId || !input.orderId || !input.userId || !input.customerEmail.includes("@")
    || !Number.isSafeInteger(input.totalMinor) || input.totalMinor <= 0 || !/^[A-Z]{3}$/.test(input.currency)
    || !input.lines.length || input.lines.some(line => !/^prod_[A-Za-z0-9]+$/.test(line.stripeProductId)
      || !/^price_[A-Za-z0-9]+$/.test(line.stripePriceId) || !Number.isSafeInteger(line.quantity) || line.quantity < 1
      || !Number.isSafeInteger(line.unitPriceMinor) || line.unitPriceMinor <= 0 || line.currency !== input.currency)) {
    throw new Error("Stripe Products and Services checkout input is invalid");
  }
  const expectedTotal = input.lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal !== input.totalMinor) {
    throw new Error("Stripe price references do not match the server order total");
  }
  return (async () => {
    const entity = stripeMerchantForCategory("other_product_or_service");
    const config = readStripeMerchantConfig(entity);
    assertStripeLiveCheckoutEnabled(entity, config.mode);
    await verifyStripeMerchantAccount(entity, fetcher);
    for (const line of input.lines) {
      const price = await stripeMerchantRequest<StripeCommercePrice>(entity, `/prices/${encodeURIComponent(line.stripePriceId)}`, {}, fetcher);
      const productId = typeof price.product === "string" ? price.product : price.product.id;
      if (!price.active || price.id !== line.stripePriceId || productId !== line.stripeProductId
        || price.currency.toUpperCase() !== input.currency || price.unit_amount !== line.unitPriceMinor) {
        throw new Error("A Products and Services Stripe Price does not match its catalogue product");
      }
    }
    const body = new URLSearchParams({
      mode: "payment",
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_creation: "always",
      customer_email: input.customerEmail,
      client_reference_id: input.attemptId,
      "payment_method_types[0]": "card",
      "metadata[merchant_entity]": "madhouse_products_services",
      "metadata[payment_attempt_id]": input.attemptId,
      "metadata[order_id]": input.orderId,
      "metadata[user_id]": input.userId,
      "payment_intent_data[metadata][merchant_entity]": "madhouse_products_services",
      "payment_intent_data[metadata][payment_attempt_id]": input.attemptId,
      "payment_intent_data[metadata][order_id]": input.orderId,
      "payment_intent_data[metadata][user_id]": input.userId,
    });
    input.lines.forEach((line, index) => {
      body.set(`line_items[${index}][price]`, line.stripePriceId);
      body.set(`line_items[${index}][quantity]`, String(line.quantity));
    });
    const session = await stripeMerchantRequest<StripeCommerceSession>(entity, "/checkout/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `r12-commerce-${input.attemptId}` },
      body,
    }, fetcher);
    if (session.mode !== "payment" || !session.id || !session.url || session.amount_total !== input.totalMinor) {
      throw new Error("Stripe returned a Products and Services session that does not match the order");
    }
    return session;
  })();
}
