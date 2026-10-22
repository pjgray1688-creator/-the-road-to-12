import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSignature } from "@/lib/join-provider-crypto";
import { adminSupabase } from "@/lib/supabase-admin";
import { readStripeMerchantConfig } from "@/lib/stripe-merchant";
import { retrieveStripeCommerceCharge, retrieveStripeCommercePaymentIntent } from "@/lib/stripe-commerce-provider";
import { reconcileControlledStripeLiveTestWebhook } from "@/lib/stripe-live-test";

export const runtime = "nodejs";

type StripeObject = Record<string, unknown>;
type StripeEvent = { id: string; type: string; created: number; livemode: boolean; account?: string; data: { object: StripeObject } };
const idOf = (value: unknown) => typeof value === "string" ? value : value && typeof value === "object" && "id" in value ? String((value as { id: unknown }).id) : null;
const amount = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

export async function POST(request: NextRequest) {
  const body = await request.text();
  let config;
  try { config = readStripeMerchantConfig("madhouse_products_services"); }
  catch { return NextResponse.json({ error: "Products and Services Stripe webhook is not configured" }, { status: 503 }); }
  if (!verifyStripeSignature(body, request.headers.get("stripe-signature"), config.webhookSecret)) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  let event: StripeEvent;
  try { event = JSON.parse(body) as StripeEvent; } catch { return NextResponse.json({ error: "Invalid payload" }, { status: 400 }); }
  if (!event.id || !Number.isSafeInteger(event.created) || !event.data?.object || event.livemode !== (config.mode === "live") || (event.account && event.account !== config.accountId)) {
    return NextResponse.json({ error: "Stripe event is not for this merchant or mode" }, { status: 400 });
  }
  const controlled = await reconcileControlledStripeLiveTestWebhook(event, "madhouse_products_services", config.accountId);
  if (controlled.handled) return new NextResponse(null, { status: controlled.status });
  const object = event.data.object;
  let kind: string | undefined;
  let attemptId = typeof (object.metadata as Record<string, unknown> | undefined)?.payment_attempt_id === "string" ? String((object.metadata as Record<string, unknown>).payment_attempt_id) : null;
  let sessionId: string | null = null;
  let paymentIntentId = idOf(object.payment_intent);
  let customerId = idOf(object.customer);
  let amountMinor = amount(object.amount_total ?? object.amount);
  let refundedMinor: number | null = null;
  let currency = typeof object.currency === "string" ? object.currency.toUpperCase() : null;
  let status = typeof object.payment_status === "string" ? object.payment_status : typeof object.status === "string" ? object.status : null;

  if (event.type.startsWith("checkout.session.")) {
    sessionId = typeof object.id === "string" ? object.id : null;
    attemptId ??= typeof object.client_reference_id === "string" ? object.client_reference_id : null;
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") kind = status === "paid" ? "checkout_paid" : "checkout_pending";
    else if (event.type === "checkout.session.async_payment_failed") kind = "checkout_failed";
    else if (event.type === "checkout.session.expired") kind = "checkout_expired";
  } else if (event.type === "payment_intent.payment_failed") {
    kind = "checkout_failed";
    amountMinor = amount(object.amount);
    paymentIntentId = typeof object.id === "string" ? object.id : null;
  } else if (["charge.refunded", "charge.dispute.created", "charge.dispute.closed"].includes(event.type)) {
    const chargeId = event.type.startsWith("charge.dispute.") ? idOf(object.charge) : typeof object.id === "string" ? object.id : null;
    if (!chargeId) return NextResponse.json({ error: "Stripe charge reference is missing" }, { status: 400 });
    try {
      const charge = await retrieveStripeCommerceCharge(chargeId);
      paymentIntentId = idOf(charge.payment_intent);
      customerId = idOf(charge.customer);
      amountMinor = amount(charge.amount);
      refundedMinor = amount(charge.amount_refunded);
      currency = typeof charge.currency === "string" ? charge.currency.toUpperCase() : currency;
      const intent = paymentIntentId ? await retrieveStripeCommercePaymentIntent(paymentIntentId) : null;
      const metadata = intent?.metadata ?? charge.metadata ?? {};
      attemptId = typeof metadata.payment_attempt_id === "string" ? metadata.payment_attempt_id : attemptId;
      if (metadata.merchant_entity !== "madhouse_products_services") return NextResponse.json({ error: "PaymentIntent belongs to a different merchant" }, { status: 400 });
      if (event.type === "charge.refunded") kind = "charge_refunded";
      else if (event.type === "charge.dispute.created") { kind = "dispute_opened"; status = "open"; }
      else { kind = "dispute_closed"; status = typeof object.status === "string" ? object.status : "lost"; }
    } catch { return NextResponse.json({ error: "Stripe payment could not be reconciled" }, { status: 500 }); }
  }
  if (!kind) return new NextResponse(null, { status: 204 });
  if (!attemptId) return NextResponse.json({ error: "Stripe event is missing its payment-attempt reference" }, { status: 400 });
  const { error } = await adminSupabase().rpc("club_record_stripe_commerce_event", {
    p_event_id: event.id, p_attempt_id: attemptId, p_merchant_entity: "madhouse_products_services", p_account_id: config.accountId,
    p_event_type: kind, p_occurred_at: new Date(event.created * 1000).toISOString(), p_session_id: sessionId,
    p_payment_intent_id: paymentIntentId, p_customer_id: customerId, p_amount_minor: amountMinor,
    p_refunded_minor: refundedMinor, p_currency: currency, p_status: status,
  });
  if (error) return NextResponse.json({ error: "Stripe event could not be reconciled" }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
