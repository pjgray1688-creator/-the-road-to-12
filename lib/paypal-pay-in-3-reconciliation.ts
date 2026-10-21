import { adminSupabase } from "@/lib/supabase-admin";
import { capturePayPalOrder, retrievePayPalOrder, type PayPalCapture, type PayPalOrder } from "@/lib/paypal-provider";

type SavedOrder = {
  id: string;
  organisation_id: string;
  requesting_user_id: string;
  amount_minor: number;
  currency: string;
  merchant_account_id: string;
  canonical_product_code: string;
  provider_order_id: string;
  status: string;
};

function orderCapture(order: PayPalOrder, saved: SavedOrder) {
  const unit = order.purchase_units?.[0];
  const amount = (saved.amount_minor / 100).toFixed(2);
  if (!unit || unit.custom_id !== saved.id || unit.reference_id !== saved.id || unit.payee?.merchant_id !== saved.merchant_account_id
    || unit.amount?.currency_code !== saved.currency || unit.amount.value !== amount) {
    throw new Error("PayPal order does not match the saved R12 order");
  }
  const capture = unit.payments?.captures?.find(item => item.status === "COMPLETED");
  if (!capture || capture.amount?.currency_code !== saved.currency || capture.amount.value !== amount) {
    throw new Error("PayPal completed capture does not match the saved R12 order");
  }
  return capture;
}

async function getSavedOrder(providerOrderId: string, buyerUserId?: string) {
  const admin = adminSupabase();
  let query = admin.from("club_paypal_pay_in_3_orders").select("id,organisation_id,requesting_user_id,amount_minor,currency,merchant_account_id,canonical_product_code,provider_order_id,status")
    .eq("provider_order_id", providerOrderId);
  if (buyerUserId) query = query.eq("buyer_user_id", buyerUserId);
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new Error("PayPal order was not found for this account");
  return data as SavedOrder;
}

async function reconcileCapture(saved: SavedOrder, capture: PayPalCapture, eventId: string) {
  const { error, data } = await adminSupabase().rpc("club_reconcile_paypal_pay_in_3_event", {
    p_provider_event_id: eventId,
    p_event_type: "capture_completed",
    p_provider_order_id: saved.provider_order_id,
    p_capture_id: capture.id,
    p_amount_minor: saved.amount_minor,
    p_currency: saved.currency,
    p_merchant_account_id: saved.merchant_account_id,
  });
  if (error || !data) throw new Error("PayPal capture could not be reconciled to the R12 membership");
  return data;
}

/** Captures only the authenticated buyer's stored order and reconciles by provider truth. */
export async function capturePayPalOrderForBuyer(providerOrderId: string, buyerUserId: string, reconciliationKey?: string) {
  const saved = await getSavedOrder(providerOrderId, buyerUserId);
  if (saved.status === "captured") return { alreadyReconciled: true };
  const providerOrder = await retrievePayPalOrder(providerOrderId);
  let capture: PayPalCapture;
  if (providerOrder.status === "COMPLETED") {
    capture = orderCapture(providerOrder, saved);
  } else {
    if (providerOrder.status !== "APPROVED") throw new Error("PayPal checkout has not been approved");
    const result = await capturePayPalOrder({
      providerOrderId, orderId: saved.id, merchantId: saved.merchant_account_id, amountMinor: saved.amount_minor,
    });
    capture = result.capture;
  }
  await reconcileCapture(saved, capture, reconciliationKey ?? `return:${capture.id}`);
  return { alreadyReconciled: false };
}

function providerOrderIdFromEvent(event: Record<string, unknown>) {
  const resource = event.resource as Record<string, unknown> | undefined;
  const related = resource?.supplementary_data as { related_ids?: { order_id?: string } } | undefined;
  if (event.event_type === "CHECKOUT.ORDER.APPROVED" || event.event_type === "CHECKOUT.ORDER.VOIDED") {
    return typeof resource?.id === "string" ? resource.id : null;
  }
  return typeof related?.related_ids?.order_id === "string" ? related.related_ids.order_id : null;
}

export async function reconcilePayPalWebhookEvent(event: Record<string, unknown>) {
  const eventId = typeof event.id === "string" ? event.id : null;
  const eventType = typeof event.event_type === "string" ? event.event_type : null;
  const providerOrderId = providerOrderIdFromEvent(event);
  if (!eventId || !eventType || !providerOrderId) throw new Error("PayPal webhook event is incomplete");
  const saved = await getSavedOrder(providerOrderId);
  if (eventType === "CHECKOUT.ORDER.APPROVED") {
    return capturePayPalOrderForBuyer(providerOrderId, saved.requesting_user_id, `webhook:${eventId}`);
  }
  if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
    const providerOrder = await retrievePayPalOrder(providerOrderId);
    if (providerOrder.status !== "COMPLETED") throw new Error("PayPal capture event is not reflected by provider order state");
    const capture = orderCapture(providerOrder, saved);
    return reconcileCapture(saved, capture, `webhook:${eventId}`);
  }
  if (eventType === "PAYMENT.CAPTURE.DENIED" || eventType === "CHECKOUT.ORDER.VOIDED") {
    // Confirm the resource still maps to this saved order before recording a
    // failure. A late completed capture is always reconciled as a payment.
    const providerOrder = await retrievePayPalOrder(providerOrderId);
    if (providerOrder.status === "COMPLETED") {
      const capture = orderCapture(providerOrder, saved);
      return reconcileCapture(saved, capture, `webhook:${eventId}`);
    }
    const unit = providerOrder.purchase_units?.[0];
    if (unit?.custom_id !== saved.id || unit.payee?.merchant_id !== saved.merchant_account_id
      || unit.amount?.currency_code !== saved.currency || unit.amount.value !== (saved.amount_minor / 100).toFixed(2)) {
      throw new Error("PayPal failure event does not match the saved order");
    }
    const admin = adminSupabase();
    const { error, data } = await admin.rpc("club_reconcile_paypal_pay_in_3_event", {
      p_provider_event_id: `webhook:${eventId}`,
      p_event_type: eventType === "CHECKOUT.ORDER.VOIDED" ? "order_cancelled" : "capture_failed",
      p_provider_order_id: providerOrderId,
      p_merchant_account_id: saved.merchant_account_id,
    });
    if (error || !data) throw new Error("PayPal failure could not be reconciled");
    return data;
  }
  // Store no unsupported event and do not mutate payment state.
  return { ignored: true };
}
