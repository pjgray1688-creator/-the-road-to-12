import { readStripeMerchantConfig, stripeMerchantRequest } from "./stripe-merchant";

export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  mode: "payment" | "subscription";
  status: "open" | "complete" | "expired" | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  payment_intent: string | null;
  customer: string | null;
  subscription: string | null;
  metadata?: Record<string, string>;
};

export type StripeCharge = { id: string; invoice: string | null; payment_intent: string | null; customer: string | null };
export type StripeInvoice = {
  id: string; customer: string | null; subscription: string | null; metadata?: Record<string, string>;
  subscription_details?: { metadata?: Record<string, string> };
  parent?: { subscription_details?: { subscription?: string | null; metadata?: Record<string, string> } };
};

export function retrieveStripeCheckoutSession(id: string, fetcher?: typeof fetch) {
  return stripeMerchantRequest<StripeCheckoutSession>("madhouse_franchise", `/checkout/sessions/${encodeURIComponent(id)}`, {}, fetcher);
}
export function retrieveStripeCharge(id: string, fetcher?: typeof fetch) {
  return stripeMerchantRequest<StripeCharge>("madhouse_franchise", `/charges/${encodeURIComponent(id)}`, {}, fetcher);
}

export function retrieveStripeInvoice(id: string, fetcher?: typeof fetch) {
  return stripeMerchantRequest<StripeInvoice>("madhouse_franchise", `/invoices/${encodeURIComponent(id)}`, {}, fetcher);
}

export function createStripeCheckoutSession(input: {
  requestId: string; generation: number; membershipProductId: string; email: string; productName: string; checkoutKind: string;
  joiningFeeMinor: number; recurringAmountMinor: number; upfrontAmountMinor: number; currency: string;
  successUrl: string; cancelUrl: string;
}, fetcher?: typeof fetch) {
  const monthly = input.checkoutKind === "monthly_recurring";
  if (!Number.isSafeInteger(input.upfrontAmountMinor) || !Number.isSafeInteger(input.recurringAmountMinor) || !Number.isSafeInteger(input.joiningFeeMinor)
    || input.upfrontAmountMinor <= 0 || input.recurringAmountMinor <= 0 || input.joiningFeeMinor < 0
    || input.upfrontAmountMinor !== input.recurringAmountMinor + input.joiningFeeMinor) throw new Error("Stripe checkout totals are invalid");
  const body = new URLSearchParams({
    mode: monthly ? "subscription" : "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.requestId,
    customer_email: input.email,
    "payment_method_types[0]": "card",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(input.recurringAmountMinor),
    "line_items[0][price_data][product_data][name]": input.productName,
    "line_items[0][price_data][product_data][metadata][merchant_entity]": "madhouse_franchise",
    "line_items[0][price_data][product_data][metadata][membership_product_id]": input.membershipProductId,
    "metadata[join_request_id]": input.requestId,
    "metadata[join_generation]": String(input.generation),
    "metadata[merchant_entity]": "madhouse_franchise",
    "metadata[membership_product_id]": input.membershipProductId,
  });
  if (monthly) {
    body.set("line_items[0][price_data][recurring][interval]", "month");
    body.set("subscription_data[metadata][join_request_id]", input.requestId);
    body.set("subscription_data[metadata][join_generation]", String(input.generation));
    body.set("subscription_data[metadata][merchant_entity]", "madhouse_franchise");
    body.set("subscription_data[metadata][membership_product_id]", input.membershipProductId);
  } else {
    body.set("customer_creation", "always");
    body.set("payment_intent_data[metadata][join_request_id]", input.requestId);
    body.set("payment_intent_data[metadata][join_generation]", String(input.generation));
    body.set("payment_intent_data[metadata][merchant_entity]", "madhouse_franchise");
    body.set("payment_intent_data[metadata][membership_product_id]", input.membershipProductId);
  }
  if (input.joiningFeeMinor > 0) {
    body.set("line_items[1][quantity]", "1");
    body.set("line_items[1][price_data][currency]", input.currency.toLowerCase());
    body.set("line_items[1][price_data][unit_amount]", String(input.joiningFeeMinor));
    body.set("line_items[1][price_data][product_data][name]", "Madhouse joining fee");
    body.set("line_items[1][price_data][product_data][metadata][merchant_entity]", "madhouse_franchise");
    body.set("line_items[1][price_data][product_data][metadata][membership_product_id]", input.membershipProductId);
  }
  return (async () => {
    const config = readStripeMerchantConfig("madhouse_franchise");
    const account = await stripeMerchantRequest<{ id: string }>("madhouse_franchise", "/account", {}, fetcher);
    if (account.id !== config.accountId) throw new Error("Stripe credentials are not for the Madhouse Franchise account");
    return stripeMerchantRequest<StripeCheckoutSession>("madhouse_franchise", "/checkout/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `r12-join-${input.requestId}-stripe-${input.generation}` },
      body,
    }, fetcher);
  })();
}
