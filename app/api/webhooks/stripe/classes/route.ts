import { NextRequest, NextResponse } from "next/server";
import { verifyStripeSignature } from "@/lib/join-provider-crypto";
import { adminSupabase } from "@/lib/supabase-admin";
import { readStripeMerchantConfig } from "@/lib/stripe-merchant";

export const runtime = "nodejs";
type StripeClassObject = {
  id: string; amount_total?: number; amount?: number; currency?: string; payment_status?: string;
  payment_intent?: string | { id: string } | null; metadata?: Record<string, string>; client_reference_id?: string;
};
type StripeEvent = { id: string; type: string; created: number; livemode?: boolean; account?: string; data: { object: StripeClassObject } };

export async function POST(request: NextRequest) {
  const body = await request.text();
  let config;
  try { config = readStripeMerchantConfig("madhouse_products_services"); }
  catch { return NextResponse.json({ error: "Products & Services class webhook is not configured" }, { status: 503 }); }
  const secret = process.env.STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET;
  if (!secret?.startsWith("whsec_")) return NextResponse.json({ error: "Products & Services class webhook is not configured" }, { status: 503 });
  if (!verifyStripeSignature(body, request.headers.get("stripe-signature"), secret)) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  let event: StripeEvent;
  try { event = JSON.parse(body) as StripeEvent; } catch { return NextResponse.json({ error: "Invalid payload" }, { status: 400 }); }
  if (event.livemode !== (config.mode === "live") || (event.account && event.account !== config.accountId)) return NextResponse.json({ error: "Stripe event does not match the Products & Services account and mode" }, { status: 400 });
  const accepted = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired", "payment_intent.payment_failed"]);
  if (!accepted.has(event.type)) return new NextResponse(null, { status: 204 });
  const session = event.data?.object;
  const bookingId = session?.metadata?.booking_id;
  const sessionId = session?.metadata?.session_id;
  const checkoutEvent = session?.id?.startsWith("cs_");
  const intentFailure = event.type === "payment_intent.payment_failed" && session?.id?.startsWith("pi_");
  if (!bookingId || !sessionId || (!checkoutEvent && !intentFailure)) return NextResponse.json({ error: "Class checkout metadata is missing" }, { status: 400 });
  const amount = session.amount_total ?? session.amount;
  const currency = session.currency?.toUpperCase();
  if (amount !== 1000 || currency !== "GBP") return NextResponse.json({ error: "Class checkout amount mismatch" }, { status: 400 });
  const isSuccess = event.type === "checkout.session.async_payment_succeeded" || event.type === "checkout.session.completed";
  if (isSuccess && session.payment_status !== "paid") return new NextResponse(null, { status: 204 });
  const paymentIntent = intentFailure ? session.id : typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
  try {
    const { error } = await adminSupabase().rpc("club_record_class_stripe_event", {
      p_event_id: event.id, p_event_type: event.type, p_booking_id: bookingId, p_session_id: sessionId, p_checkout_id: checkoutEvent ? session.id : null,
      p_payment_intent_id: paymentIntent, p_amount_minor: amount, p_currency: currency, p_paid: isSuccess,
      p_event_time: new Date(event.created * 1000).toISOString(),
    });
    if (error) throw error;
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Class payment event could not be recorded" }, { status: 500 });
  }
}
