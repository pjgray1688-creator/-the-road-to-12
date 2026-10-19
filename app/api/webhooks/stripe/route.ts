import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSignature } from "@/lib/join-provider-crypto";
import { stripeMembershipEvent } from "@/lib/join-provider-events";
import { retrieveStripeCharge, retrieveStripeInvoice } from "@/lib/stripe-join-provider";
import { adminSupabase } from "@/lib/supabase-admin";
import { readStripeMerchantConfig } from "@/lib/stripe-merchant";

export const runtime = "nodejs";

type StripeEvent = { id: string; type: string; created: number; livemode: boolean; account?: string; data: { object: Parameters<typeof stripeMembershipEvent>[0]["data"]["object"] } };

export async function POST(request: NextRequest) {
  const body = await request.text();
  let config;
  try { config = readStripeMerchantConfig("madhouse_franchise"); }
  catch { return NextResponse.json({ error: "Madhouse Franchise Stripe webhook is not configured" }, { status: 503 }); }
  if (!verifyStripeSignature(body, request.headers.get("stripe-signature"), config.webhookSecret)) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  let event: StripeEvent;
  try { event = JSON.parse(body) as StripeEvent; } catch { return NextResponse.json({ error: "Invalid payload" }, { status: 400 }); }
  if (event.livemode !== (config.mode === "live")) return NextResponse.json({ error: "Stripe event mode does not match this deployment" }, { status: 400 });
  if (event.account && event.account !== config.accountId) return NextResponse.json({ error: "Stripe event is from the wrong merchant account" }, { status: 400 });
  let parsed = stripeMembershipEvent(event);
  if (!parsed) return new NextResponse(null, { status: 204 });
  try {
    // Dispute objects do not carry invoice/subscription metadata. Resolve the
    // signed charge reference through Stripe so recurring reversals can still
    // be matched to their durable joining/billing record.
    if (!parsed.requestId && parsed.chargeId && !parsed.invoiceId) {
      const charge = await retrieveStripeCharge(parsed.chargeId);
      parsed = { ...parsed, invoiceId: charge.invoice, paymentIntentId: parsed.paymentIntentId ?? charge.payment_intent, customerId: parsed.customerId ?? charge.customer };
    }
    if (!parsed.requestId && parsed.invoiceId && !parsed.subscriptionId) {
      const invoice = await retrieveStripeInvoice(parsed.invoiceId);
      const details = invoice.parent?.subscription_details;
      const metadata = [invoice.metadata, invoice.subscription_details?.metadata, details?.metadata]
        .find(value => value?.join_request_id || value?.join_generation);
      const generation = Number(metadata?.join_generation);
      parsed = { ...parsed, requestId: metadata?.join_request_id ?? null,
        generation: Number.isSafeInteger(generation) && generation > 0 ? generation : null,
        subscriptionId: invoice.subscription ?? details?.subscription ?? null, customerId: parsed.customerId ?? invoice.customer };
    }
    if (!parsed.requestId) throw new Error("Stripe event is missing its joining request identity");
    const { error } = await adminSupabase().rpc("club_record_stripe_membership_event_for_account", {
      p_request_id: parsed.requestId, p_attempt_generation: parsed.generation, p_provider_event_key: event.id, p_event_type: parsed.eventType,
      p_occurred_at: parsed.occurredAt, p_session_id: parsed.sessionId, p_payment_intent_id: parsed.paymentIntentId,
      p_customer_id: parsed.customerId, p_subscription_id: parsed.subscriptionId, p_invoice_id: parsed.invoiceId,
      p_charge_id: parsed.chargeId, p_amount_minor: parsed.amountMinor, p_currency: parsed.currency,
      p_status: parsed.status, p_billing_reason: parsed.billingReason, p_period_start: parsed.periodStart, p_period_end: parsed.periodEnd,
      p_merchant_entity: config.entity, p_account_id: config.accountId,
    });
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Stripe event could not be recorded" }, { status: 500 });
  }
}
