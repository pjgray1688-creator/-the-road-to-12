export type JoinProviderEvent = {
  requestId: string;
  eventType: "upfront_confirmed" | "upfront_failed" | "mandate_confirmed" | "mandate_failed";
  reference: string;
  amountMinor: number | null;
  occurredAt: string;
};

export function stripeJoinEvent(event: { type: string; created: number; data: { object: { id: string; amount?: number; amount_total?: number; payment_status?: string; metadata?: Record<string, string> } } }): JoinProviderEvent | null {
  const object = event.data.object;
  const requestId = object.metadata?.join_request_id;
  if (!requestId) return null;
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type) && object.payment_status === "paid") {
    return { requestId, eventType: "upfront_confirmed", reference: object.id, amountMinor: object.amount_total ?? object.amount ?? null, occurredAt: new Date(event.created * 1000).toISOString() };
  }
  if (["checkout.session.async_payment_failed", "checkout.session.expired", "payment_intent.payment_failed"].includes(event.type)) {
    return { requestId, eventType: "upfront_failed", reference: object.id, amountMinor: object.amount_total ?? object.amount ?? null, occurredAt: new Date(event.created * 1000).toISOString() };
  }
  return null;
}

export function goCardlessJoinEvent(event: { created_at: string; resource_type: string; action: string; links?: { mandate?: string } }): JoinProviderEvent | null {
  const mandate = event.links?.mandate;
  if (event.resource_type !== "mandates" || !mandate) return null;
  if (event.action === "active") return { requestId: "", eventType: "mandate_confirmed", reference: mandate, amountMinor: null, occurredAt: event.created_at };
  if (["failed", "cancelled", "expired", "replaced"].includes(event.action)) return { requestId: "", eventType: "mandate_failed", reference: mandate, amountMinor: null, occurredAt: event.created_at };
  return null;
}
