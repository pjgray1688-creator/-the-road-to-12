import { assertGoCardlessConfiguration, createGoCardlessPayment, GoCardlessRequestError } from "@/lib/gocardless-join-provider";

export type RecurringCollectionClaim = {
  id: string; arrangement_id: string; membership_id: string; amount_minor: number; currency: string;
  provider_subscription_reference: string; period_key: string;
};

type RpcResult = { data: unknown; error: { message?: string } | null };
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult> };
type PaymentCreator = typeof createGoCardlessPayment;

export function billingWorkerId() { return `billing-${crypto.randomUUID()}`; }

export async function runGoCardlessCollections(client: RpcClient, createPayment: PaymentCreator = createGoCardlessPayment, workerId = billingWorkerId()) {
  assertGoCardlessConfiguration();
  const claimed = await client.rpc("club_claim_due_gocardless_collections", { p_limit: 25, p_worker_id: workerId, p_claim_ttl_seconds: 900 });
  if (claimed.error) throw new Error(claimed.error.message || "Due collections could not be claimed");
  const rows = Array.isArray(claimed.data) ? claimed.data as RecurringCollectionClaim[] : [];
  const summary = { claimed: rows.length, created: 0, resumable: 0, failed: 0 };
  for (const row of rows) {
    try {
      const payment = await createPayment({
        obligationId: row.id, arrangementId: row.arrangement_id, mandateId: row.provider_subscription_reference,
        amountMinor: row.amount_minor, currency: row.currency, description: `R12 membership ${row.period_key}`,
      });
      if (!payment.id?.startsWith("PM") || payment.amount !== row.amount_minor || payment.currency !== row.currency) throw new Error("GoCardless returned an invalid payment");
      const stored = await client.rpc("club_store_gocardless_collection", {
        p_obligation_id: row.id, p_worker_id: workerId, p_provider_payment_id: payment.id,
        p_provider_status: payment.status, p_charge_date: payment.charge_date ?? null,
      });
      if (stored.error) throw new Error(stored.error.message || "Collection response could not be stored");
      summary.created++;
    } catch (error) {
      const retryable = error instanceof GoCardlessRequestError ? error.retryable : true;
      if (retryable) { summary.resumable++; continue; }
      summary.failed++;
      const failed = await client.rpc("club_fail_gocardless_collection_attempt", {
        p_obligation_id: row.id, p_worker_id: workerId, p_failure_reason: error instanceof Error ? error.message.slice(0, 300) : "Provider rejected collection",
      });
      if (failed.error) throw new Error(failed.error.message || "Collection failure could not be recorded");
    }
  }
  return summary;
}

export type GoCardlessWebhookEvent = { id: string; created_at: string; resource_type: string; action: string; details?: { cause?: string; description?: string; will_attempt_retry?: boolean }; links?: { payment?: string; mandate?: string } };

export function goCardlessPaymentEvent(event: GoCardlessWebhookEvent) {
  const reference = event.links?.payment;
  if (event.resource_type !== "payments" || !reference) return null;
  const mapping: Record<string, string> = {
    created: "created", submitted: "submitted", confirmed: "confirmed", paid_out: "paid_out",
    failed: "failed", cancelled: "cancelled", charged_back: "charged_back", retry_scheduled: "retry_scheduled",
    resubmission_requested: "retry_scheduled", customer_approval_granted: "submitted",
    chargeback_cancelled: "confirmed", late_failure_settled: "confirmed",
  };
  const status = mapping[event.action];
  if (!status) return null;
  return { reference, status, occurredAt: event.created_at, failureReason: event.details?.description ?? event.details?.cause ?? null, retryExpected: event.details?.will_attempt_retry ?? ["retry_scheduled", "resubmission_requested"].includes(event.action) };
}

export function goCardlessMandateEvent(event: GoCardlessWebhookEvent) {
  const reference = event.links?.mandate;
  if (event.resource_type !== "mandates" || !reference || !["active", "failed", "cancelled", "expired", "replaced"].includes(event.action)) return null;
  return { reference, status: event.action, occurredAt: event.created_at };
}
