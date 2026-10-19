export type JoinProviderEvent = {
  requestId: string;
  eventType: "upfront_confirmed" | "upfront_failed" | "mandate_confirmed" | "mandate_failed";
  reference: string;
  amountMinor: number | null;
  occurredAt: string;
};

type StripeReference = string | { id: string } | null | undefined;
type StripeObject = {
  id: string; object?: string; status?: string; amount?: number; amount_due?: number; amount_paid?: number;
  amount_refunded?: number; amount_total?: number; currency?: string; payment_status?: string; billing_reason?: string;
  payment_intent?: StripeReference; customer?: StripeReference; subscription?: StripeReference; invoice?: StripeReference;
  charge?: StripeReference; current_period_start?: number; current_period_end?: number; period_start?: number; period_end?: number;
  metadata?: Record<string, string>; subscription_details?: { metadata?: Record<string, string> };
  parent?: { subscription_details?: { subscription?: StripeReference; metadata?: Record<string, string> } };
};

export type StripeMembershipEvent = {
  requestId: string | null;
  generation: number | null;
  eventType: "checkout_paid" | "checkout_failed" | "subscription_active" | "subscription_incomplete" | "subscription_past_due" | "subscription_cancelled" | "invoice_paid" | "invoice_failed" | "charge_refunded" | "dispute_opened" | "dispute_closed";
  occurredAt: string; sessionId: string | null; paymentIntentId: string | null; customerId: string | null;
  subscriptionId: string | null; invoiceId: string | null; chargeId: string | null; amountMinor: number | null;
  currency: string | null; status: string | null; billingReason: string | null; periodStart: string | null; periodEnd: string | null;
};

function stripeId(value: StripeReference) { return typeof value === "string" ? value : value?.id ?? null; }
function stripeIso(value?: number) { return value == null ? null : new Date(value * 1000).toISOString(); }

export function stripeMembershipEvent(event: { type: string; created: number; data: { object: StripeObject } }): StripeMembershipEvent | null {
  const object = event.data.object;
  const metadata = [object.metadata, object.subscription_details?.metadata, object.parent?.subscription_details?.metadata]
    .find(value => value?.join_request_id || value?.join_generation);
  const parsedGeneration = Number(metadata?.join_generation);
  const base = {
    requestId: metadata?.join_request_id ?? null,
    generation: Number.isSafeInteger(parsedGeneration) && parsedGeneration > 0 ? parsedGeneration : null,
    occurredAt: new Date(event.created * 1000).toISOString(),
    sessionId: object.object === "checkout.session" || object.id.startsWith("cs_") ? object.id : null,
    paymentIntentId: stripeId(object.payment_intent) ?? (object.id.startsWith("pi_") ? object.id : null),
    customerId: stripeId(object.customer),
    subscriptionId: stripeId(object.subscription) ?? stripeId(object.parent?.subscription_details?.subscription) ?? (object.object === "subscription" ? object.id : null),
    invoiceId: object.object === "invoice" || object.id.startsWith("in_") ? object.id : stripeId(object.invoice),
    chargeId: object.object === "charge" || object.id.startsWith("ch_") ? object.id : stripeId(object.charge),
    amountMinor: object.amount_paid ?? object.amount_total ?? object.amount_due ?? object.amount ?? null,
    currency: object.currency?.toUpperCase() ?? null,
    status: object.status ?? object.payment_status ?? null,
    billingReason: object.billing_reason ?? null,
    periodStart: stripeIso(object.period_start ?? object.current_period_start),
    periodEnd: stripeIso(object.period_end ?? object.current_period_end),
  };
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type) && object.payment_status === "paid") return { ...base, eventType: "checkout_paid" };
  if (["checkout.session.async_payment_failed", "checkout.session.expired", "payment_intent.payment_failed"].includes(event.type)) return { ...base, eventType: "checkout_failed" };
  if (["customer.subscription.created", "customer.subscription.updated"].includes(event.type)) {
    if (["active", "trialing"].includes(object.status ?? "")) return { ...base, eventType: "subscription_active" };
    if (["incomplete", "incomplete_expired", "paused"].includes(object.status ?? "")) return { ...base, eventType: "subscription_incomplete" };
    if (["past_due", "unpaid"].includes(object.status ?? "")) return { ...base, eventType: "subscription_past_due" };
  }
  if (event.type === "customer.subscription.deleted") return { ...base, eventType: "subscription_cancelled" };
  if (["invoice.paid", "invoice.payment_succeeded"].includes(event.type)) return { ...base, eventType: "invoice_paid" };
  if (["invoice.payment_failed", "invoice.payment_action_required"].includes(event.type)) return { ...base, eventType: "invoice_failed" };
  if (event.type === "charge.refunded" || (event.type === "charge.updated" && (object.amount_refunded ?? 0) > 0)) return { ...base, amountMinor: object.amount_refunded ?? object.amount ?? null, eventType: "charge_refunded" };
  if (event.type === "charge.dispute.created") return { ...base, eventType: "dispute_opened" };
  if (event.type === "charge.dispute.closed") return { ...base, eventType: "dispute_closed" };
  return null;
}

export function stripeJoinEvent(event: { type: string; created: number; data: { object: StripeObject } }): JoinProviderEvent | null {
  const parsed = stripeMembershipEvent(event);
  if (!parsed?.requestId || !["checkout_paid", "checkout_failed"].includes(parsed.eventType)) return null;
  return { requestId: parsed.requestId, eventType: parsed.eventType === "checkout_paid" ? "upfront_confirmed" : "upfront_failed", reference: parsed.sessionId ?? parsed.paymentIntentId ?? event.data.object.id, amountMinor: parsed.amountMinor, occurredAt: parsed.occurredAt };
}

export function goCardlessJoinEvent(event: { created_at: string; resource_type: string; action: string; links?: { mandate?: string } }): JoinProviderEvent | null {
  const mandate = event.links?.mandate;
  if (event.resource_type !== "mandates" || !mandate) return null;
  if (event.action === "active") return { requestId: "", eventType: "mandate_confirmed", reference: mandate, amountMinor: null, occurredAt: event.created_at };
  if (["failed", "cancelled", "expired", "replaced"].includes(event.action)) return { requestId: "", eventType: "mandate_failed", reference: mandate, amountMinor: null, occurredAt: event.created_at };
  return null;
}
