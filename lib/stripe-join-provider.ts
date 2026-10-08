export type StripeCheckoutSession = {
  id: string;
  url: string | null;
  status: "open" | "complete" | "expired" | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  payment_intent: string | null;
  metadata?: Record<string, string>;
};

function stripeKey() {
  const value = process.env.STRIPE_SECRET_KEY;
  if (!value) throw new Error("Stripe checkout is not configured");
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

export function createStripeCheckoutSession(input: {
  requestId: string; generation: number; email: string; productName: string; amountMinor: number; currency: string;
  successUrl: string; cancelUrl: string;
}, fetcher?: typeof fetch) {
  const body = new URLSearchParams({
    mode: "payment",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.requestId,
    customer_email: input.email,
    customer_creation: "always",
    "payment_method_types[0]": "card",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(input.amountMinor),
    "line_items[0][price_data][product_data][name]": input.productName,
    "metadata[join_request_id]": input.requestId,
    "payment_intent_data[metadata][join_request_id]": input.requestId,
  });
  return stripeRequest<StripeCheckoutSession>("/checkout/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `r12-join-${input.requestId}-card-${input.generation}` },
    body,
  }, fetcher);
}
