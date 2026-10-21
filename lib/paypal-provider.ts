export type PayPalEnvironment = "sandbox" | "live";

export type PayPalProviderConfig = {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  environment: PayPalEnvironment;
};

export type PayPalOrder = {
  id: string;
  status: "CREATED" | "SAVED" | "APPROVED" | "VOIDED" | "COMPLETED" | string;
  links?: Array<{ href: string; rel: string; method?: string }>;
  purchase_units?: Array<{
    reference_id?: string;
    custom_id?: string;
    invoice_id?: string;
    amount?: { currency_code?: string; value?: string };
    payee?: { merchant_id?: string };
    payments?: { captures?: Array<PayPalCapture> };
  }>;
};

export type PayPalCapture = {
  id: string;
  status: string;
  amount?: { currency_code?: string; value?: string };
  seller_receivable_breakdown?: { gross_amount?: { currency_code?: string; value?: string } };
  seller_protection?: { status?: string };
};

export function readPayPalProviderConfig(env: NodeJS.ProcessEnv = process.env): PayPalProviderConfig {
  const clientId = env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim();
  const webhookId = env.PAYPAL_WEBHOOK_ID?.trim();
  const environment = env.PAYPAL_ENVIRONMENT?.trim().toLowerCase();
  if (!clientId || !clientSecret || !webhookId) throw new Error("PayPal server credentials are incomplete");
  if (environment !== "sandbox" && environment !== "live") throw new Error("PAYPAL_ENVIRONMENT must be sandbox or live");
  if (env.NODE_ENV === "production" && env.VERCEL_ENV !== "preview" && environment !== "live") {
    throw new Error("Production PayPal must use the live API environment");
  }
  return { clientId, clientSecret, webhookId, environment };
}

export function isPayPalPayIn3Enabled(env: NodeJS.ProcessEnv = process.env) {
  return env.R12_PAYPAL_PAY_IN_3_ENABLED === "true";
}

const apiRoot = (environment: PayPalEnvironment) => environment === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

async function jsonResponse<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null) as (T & { name?: string }) | null;
  if (!response.ok || !value) throw new Error("PayPal request failed");
  return value;
}

async function accessToken(config: PayPalProviderConfig, fetcher: typeof fetch) {
  const authorization = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetcher(`${apiRoot(config.environment)}/v1/oauth2/token`, {
    method: "POST", headers: { Authorization: `Basic ${authorization}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials", cache: "no-store",
  });
  const value = await jsonResponse<{ access_token: string }>(response);
  if (!value.access_token) throw new Error("PayPal authentication failed");
  return value.access_token;
}

async function paypalRequest<T>(path: string, init: RequestInit, config: PayPalProviderConfig, fetcher: typeof fetch) {
  const token = await accessToken(config, fetcher);
  return jsonResponse<T>(await fetcher(`${apiRoot(config.environment)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  }));
}

export async function createPayPalOrder(input: {
  orderId: string;
  merchantId: string;
  amountMinor: number;
  currency: "GBP";
  description: string;
  returnUrl: string;
  cancelUrl: string;
}, options: { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch } = {}): Promise<PayPalOrder> {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !input.merchantId || !input.orderId) {
    throw new Error("PayPal order details are invalid");
  }
  const config = readPayPalProviderConfig(options.env);
  const amount = (input.amountMinor / 100).toFixed(2);
  const order = await paypalRequest<PayPalOrder>("/v2/checkout/orders", {
    method: "POST",
    headers: { "PayPal-Request-Id": `r12-paypal-${input.orderId}`, Prefer: "return=representation" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: input.orderId,
        custom_id: input.orderId,
        invoice_id: `R12-${input.orderId}`,
        description: input.description.slice(0, 127),
        amount: { currency_code: input.currency, value: amount },
        payee: { merchant_id: input.merchantId },
      }],
      payment_source: { paypal: { experience_context: {
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        user_action: "PAY_NOW",
        shipping_preference: "NO_SHIPPING",
      } } },
    }),
  }, config, options.fetcher ?? fetch);
  const unit = order.purchase_units?.[0];
  if (!order.id || order.status !== "CREATED" || unit?.custom_id !== input.orderId || unit.reference_id !== input.orderId || unit.payee?.merchant_id !== input.merchantId
    || unit.amount?.currency_code !== "GBP" || unit.amount.value !== amount) throw new Error("PayPal returned an order that does not match the saved checkout");
  return order;
}

export function retrievePayPalOrder(orderId: string, options: { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch } = {}) {
  const config = readPayPalProviderConfig(options.env);
  return paypalRequest<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: "GET" }, config, options.fetcher ?? fetch);
}

export async function capturePayPalOrder(input: {
  providerOrderId: string;
  orderId: string;
  merchantId: string;
  amountMinor: number;
}, options: { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch } = {}) {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error("PayPal amount is invalid");
  const config = readPayPalProviderConfig(options.env);
  const order = await paypalRequest<PayPalOrder>(`/v2/checkout/orders/${encodeURIComponent(input.providerOrderId)}/capture`, {
    method: "POST", headers: { "PayPal-Request-Id": `r12-paypal-capture-${input.orderId}`, Prefer: "return=representation" }, body: "{}",
  }, config, options.fetcher ?? fetch);
  const unit = order.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  const amount = (input.amountMinor / 100).toFixed(2);
  if (order.id !== input.providerOrderId || order.status !== "COMPLETED" || unit?.custom_id !== input.orderId || unit.reference_id !== input.orderId || unit.payee?.merchant_id !== input.merchantId
    || unit.amount?.currency_code !== "GBP" || unit.amount.value !== amount || !capture?.id || capture.status !== "COMPLETED"
    || capture.amount?.currency_code !== "GBP" || capture.amount.value !== amount) {
    throw new Error("PayPal capture has not been verified against the saved checkout");
  }
  return { order, capture };
}

export async function verifyPayPalWebhook(input: {
  headers: Headers;
  event: unknown;
}, options: { env?: NodeJS.ProcessEnv; fetcher?: typeof fetch } = {}) {
  const config = readPayPalProviderConfig(options.env);
  const transmissionId = input.headers.get("paypal-transmission-id");
  const transmissionTime = input.headers.get("paypal-transmission-time");
  const transmissionSignature = input.headers.get("paypal-transmission-sig");
  const certUrl = input.headers.get("paypal-cert-url");
  const authAlgo = input.headers.get("paypal-auth-algo");
  if (!transmissionId || !transmissionTime || !transmissionSignature || !certUrl || !authAlgo) return false;
  const result = await paypalRequest<{ verification_status?: string }>("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: JSON.stringify({
      auth_algo: authAlgo, cert_url: certUrl, transmission_id: transmissionId,
      transmission_sig: transmissionSignature, transmission_time: transmissionTime,
      webhook_id: config.webhookId, webhook_event: input.event,
    }),
  }, config, options.fetcher ?? fetch);
  return result.verification_status === "SUCCESS";
}
