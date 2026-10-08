import { NextRequest, NextResponse } from "next/server";
import { verifyGoCardlessSignature } from "@/lib/join-provider-crypto";
import { goCardlessJoinEvent } from "@/lib/join-provider-events";
import { goCardlessMandateEvent, goCardlessPaymentEvent, type GoCardlessWebhookEvent } from "@/lib/gocardless-recurring";
import { adminSupabase } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const secret = process.env.GOCARDLESS_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "GoCardless webhook is not configured" }, { status: 503 });
  if (!verifyGoCardlessSignature(body, request.headers.get("webhook-signature"), secret)) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  let events: GoCardlessWebhookEvent[];
  try { const value = JSON.parse(body) as { events?: GoCardlessWebhookEvent[] }; events = Array.isArray(value.events) ? value.events : []; }
  catch { return NextResponse.json({ error: "Invalid payload" }, { status: 400 }); }
  try {
    const admin = adminSupabase();
    for (const event of events) {
      const payment = goCardlessPaymentEvent(event);
      if (payment) {
        const { error } = await admin.rpc("club_reconcile_gocardless_collection_event", {
          p_provider_event_key: event.id, p_provider_payment_id: payment.reference, p_provider_status: payment.status,
          p_occurred_at: payment.occurredAt, p_failure_reason: payment.failureReason, p_retry_expected: payment.retryExpected,
        });
        if (error) throw error;
        continue;
      }
      const mandate = goCardlessMandateEvent(event);
      if (!mandate) continue;
      const parsed = goCardlessJoinEvent(event);
      if (parsed) {
        const lookup = await admin.rpc("club_find_join_request_by_provider_reference", { p_provider_type: "gocardless", p_provider_reference: parsed.reference });
        if (lookup.error) throw lookup.error;
        if (lookup.data) {
          const { error } = await admin.rpc("club_record_join_provider_event", {
            p_request_id: lookup.data, p_provider_type: "gocardless", p_provider_event_key: event.id, p_event_type: parsed.eventType,
            p_amount_minor: null, p_provider_reference: parsed.reference, p_occurred_at: parsed.occurredAt,
          });
          if (error) throw error;
        }
      }
      // Joining confirmation may create the arrangement, so reconcile its
      // mandate only after the join event has been applied.
      const recurring = await admin.rpc("club_reconcile_gocardless_mandate_event", {
        p_provider_event_key: event.id, p_mandate_id: mandate.reference, p_provider_status: mandate.status, p_occurred_at: mandate.occurredAt,
      });
      if (recurring.error) throw recurring.error;
    }
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "GoCardless events could not be recorded" }, { status: 500 });
  }
}
