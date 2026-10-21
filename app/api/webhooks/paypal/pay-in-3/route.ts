import { NextRequest, NextResponse } from "next/server";
import { reconcilePayPalWebhookEvent } from "@/lib/paypal-pay-in-3-reconciliation";
import { verifyPayPalWebhook } from "@/lib/paypal-provider";

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (body.length > 256_000) return NextResponse.json({ error: "Webhook payload is too large" }, { status: 413 });
  let event: Record<string, unknown>;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    event = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
  }
  try {
    if (!await verifyPayPalWebhook({ headers: request.headers, event })) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
    const result = await reconcilePayPalWebhookEvent(event);
    return NextResponse.json({ received: true, result });
  } catch {
    // Non-2xx lets PayPal retry if local reconciliation is temporarily down.
    return NextResponse.json({ error: "PayPal event could not be reconciled" }, { status: 503 });
  }
}
