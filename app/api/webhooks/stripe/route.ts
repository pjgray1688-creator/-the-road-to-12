import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSignature } from "@/lib/join-provider-crypto";
import { stripeJoinEvent } from "@/lib/join-provider-events";
import { adminSupabase } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type StripeObject = { id: string; amount?: number; amount_total?: number; payment_intent?: string | null; payment_status?: string; metadata?: Record<string, string> };
type StripeEvent = { id: string; type: string; created: number; data: { object: StripeObject } };

export async function POST(request: NextRequest) {
  const body = await request.text();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Stripe webhook is not configured" }, { status: 503 });
  if (!verifyStripeSignature(body, request.headers.get("stripe-signature"), secret)) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  let event: StripeEvent;
  try { event = JSON.parse(body) as StripeEvent; } catch { return NextResponse.json({ error: "Invalid payload" }, { status: 400 }); }
  const object = event.data.object;
  const parsed = stripeJoinEvent(event);
  if (!parsed) return new NextResponse(null, { status: 204 });
  try {
    const admin = adminSupabase();
    if (object.id.startsWith("cs_")) {
      const { error } = await admin.rpc("club_store_join_provider_resource", {
        p_request_id: parsed.requestId, p_provider_type: "stripe", p_primary_reference: object.id,
        p_payment_reference: object.payment_intent ?? null, p_customer_reference: null, p_bank_account_reference: null, p_mandate_reference: null,
      });
      if (error) throw error;
    }
    const { error } = await admin.rpc("club_record_join_provider_event", {
      p_request_id: parsed.requestId, p_provider_type: "stripe", p_provider_event_key: event.id, p_event_type: parsed.eventType,
      p_amount_minor: parsed.amountMinor, p_provider_reference: parsed.reference, p_occurred_at: parsed.occurredAt,
    });
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Stripe event could not be recorded" }, { status: 500 });
  }
}
