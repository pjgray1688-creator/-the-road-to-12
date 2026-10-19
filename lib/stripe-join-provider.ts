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

function stripeKey() {
  const value = process.env.STRIPE_SECRET_KEY;
  if (!value) throw new Error("Stripe checkout is not configured");
  const mode = process.env.STRIPE_MEMBERSHIP_MODE;
  if (!mode || !["test", "live"].includes(mode)) throw new Error("Stripe membership mode is not configured");
  if (mode === "test" && !value.startsWith("sk_test_")) throw new Error("Stripe test mode requires a test secret key");
  if (mode === "live" && !value.startsWith("sk_live_")) throw new Error("Stripe live mode requires a live secret key");
  return value;
}

function stripeFranchiseAccountId() {
  const value = process.env.STRIPE_FRANCHISE_ACCOUNT_ID;
  if (!value?.startsWith("acct_")) throw new Error("Stripe Franchise account is not configured");
  return value;
}

async function stripeRequest<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`https://api.stripe.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${stripeKey()}`, ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const value = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(value.error?.message || "Stripe request failed");
  return value;
}

export function retrieveStripeCheckoutSession(id: string, fetcher?: typeof fetch) {
  return stripeRequest<StripeCheckoutSession>(`/checkout/sessions/${encodeURIComponent(id)}`, {}, fetcher);
}

export function retrieveStripeCharge(id: string, fetcher?: typeof fetch) {
  return stripeRequest<StripeCharge>(`/charges/${encodeURIComponent(id)}`, {}, fetcher);
}

export function retrieveStripeInvoice(id: string, fetcher?: typeof fetch) {
  return stripeRequest<StripeInvoice>(`/invoices/${encodeURIComponent(id)}`, {}, fetcher);
}

export function createStripeCheckoutSession(input: {
  requestId: string; generation: number; email: string; productName: string; checkoutKind: string;
  joiningFeeMinor: number; recurringAmountMinor: number; upfrontAmountMinor: number; currency: string;
  successUrl: string; cancelUrl: string;
}, fetcher?: typeof fetch) {
  const monthly = input.checkoutKind === "monthly_recurring";
  if (!Number.isSafeInteger(input.upfrontAmountMinor) || !Number.isSafeInteger(input.recurringAmountMinor) || !Number.isSafeInteger(input.joiningFeeMinor)
    || input.upfrontAmountMinor <= 0 || input.recurringAmountMinor <= 0 || input.joiningFeeMinor < 0
    || (monthly && input.upfrontAmountMinor !== input.recurringAmountMinor + input.joiningFeeMinor)
    || (!monthly && input.upfrontAmountMinor !== input.recurringAmountMinor)) throw new Error("Stripe checkout totals are invalid");
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
    "metadata[join_request_id]": input.requestId,
  });
  if (monthly) {
    body.set("line_items[0][price_data][recurring][interval]", "month");
    body.set("subscription_data[metadata][join_request_id]", input.requestId);
    if (input.joiningFeeMinor > 0) {
      body.set("line_items[1][quantity]", "1");
      body.set("line_items[1][price_data][currency]", input.currency.toLowerCase());
      body.set("line_items[1][price_data][unit_amount]", String(input.joiningFeeMinor));
      body.set("line_items[1][price_data][product_data][name]", "Madhouse joining fee");
    }
  } else {
    body.set("customer_creation", "always");
    body.set("payment_intent_data[metadata][join_request_id]", input.requestId);
  }
  return (async () => {
    const expectedAccount = stripeFranchiseAccountId();
    const account = await stripeRequest<{ id: string }>("/account", {}, fetcher);
    if (account.id !== expectedAccount) throw new Error("Stripe credentials are not for the Madhouse Franchise account");
    return stripeRequest<StripeCheckoutSession>("/checkout/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `r12-join-${input.requestId}-stripe-${input.generation}` },
      body,
    }, fetcher);
  })();
}
