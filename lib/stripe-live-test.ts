import type { StripeMerchantEntity } from "./stripe-merchant";
import { adminSupabase } from "./supabase-admin";

export const MADHOUSE_ORGANISATION_ID = "fa44592a-1593-4ad3-a621-63a4a4bcbceb";
export const STRIPE_LIVE_TEST_AMOUNT_MINOR = 100;

export const stripeLiveTestMerchants: Record<StripeMerchantEntity, {
  title: string;
  dashboardName: string;
  lineName: string;
}> = {
  madhouse_franchise: {
    title: "Madhouse Franchise",
    dashboardName: "Madhouse Gym Rotherham",
    lineName: "R12 £1 routing test — Madhouse Gym Rotherham (Franchise account)",
  },
  madhouse_products_services: {
    title: "Madhouse Products & Services",
    dashboardName: "Madhouse Gym Carlton",
    lineName: "R12 £1 routing test — Madhouse Gym Carlton (Products & Services account)",
  },
};

export type StripeLiveTestEventInput = {
  entity: StripeMerchantEntity;
  accountId: string;
  eventId: string;
  eventType: string;
  eventCreated: number;
  runId: string;
  sessionId: string | null;
  paymentIntentId: string | null;
  amountMinor: number | null;
  currency: string | null;
  mode: string | null;
  livemode: boolean;
  checkoutStatus: string | null;
  paymentStatus: string | null;
};

export function validateStripeLiveTestEvent(input: StripeLiveTestEventInput, expectedEntity: StripeMerchantEntity, expectedAccountId: string) {
  if (input.entity !== expectedEntity || input.accountId !== expectedAccountId) return "merchant_mismatch" as const;
  if (!/^evt_[A-Za-z0-9]+$/.test(input.eventId) || !/^[0-9a-f-]{36}$/i.test(input.runId)
    || !Number.isSafeInteger(input.eventCreated) || input.eventCreated <= 0 || input.eventCreated > 8_000_000_000) return "reference_invalid" as const;
  if (input.amountMinor !== STRIPE_LIVE_TEST_AMOUNT_MINOR || input.currency?.toUpperCase() !== "GBP" || input.mode !== "payment" || input.livemode !== true) return "payment_details_mismatch" as const;
  if (input.eventType === "payment_intent.payment_failed") return /^pi_[A-Za-z0-9]+$/.test(input.paymentIntentId ?? "") && input.sessionId === null ? "valid" as const : "payment_reference_missing" as const;
  if (!/^cs_live_[A-Za-z0-9]+$/.test(input.sessionId ?? "")) return "reference_invalid" as const;
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"].includes(input.eventType)) return "event_unsupported" as const;
  if ((input.eventType === "checkout.session.completed" || input.eventType === "checkout.session.async_payment_succeeded")
    && input.paymentStatus === "paid" && !/^pi_[A-Za-z0-9]+$/.test(input.paymentIntentId ?? "")) return "payment_reference_missing" as const;
  return "valid" as const;
}

export function safeStripeTestFailure(error: unknown): string {
  const status = typeof error === "object" && error && "safe" in error
    ? (error as { safe?: { status?: unknown; code?: unknown } }).safe : undefined;
  if (typeof status?.status === "number") {
    const code = typeof status.code === "string" ? status.code : "provider_error";
    return `stripe_http_${status.status}_${code}`.replace(/[^a-z0-9_]/g, "_").slice(0, 96);
  }
  if (error instanceof Error && error.name === "StripeMerchantNetworkError") return "stripe_network_failure";
  return "configuration_or_session_validation_failed";
}

type SignedStripeEvent = { id?: unknown; type?: unknown; created?: unknown; livemode?: unknown; account?: unknown; data?: { object?: Record<string, unknown> } };
const stripeObjectId = (value: unknown): string | null => typeof value === "string" ? value
  : value && typeof value === "object" && "id" in value && typeof (value as { id: unknown }).id === "string" ? (value as { id: string }).id : null;

/** Called only after the route verifies the endpoint-specific Stripe signature. */
export async function reconcileControlledStripeLiveTestWebhook(event: SignedStripeEvent, expectedEntity: StripeMerchantEntity, accountId: string) {
  const object = event.data?.object;
  const metadata = object?.metadata && typeof object.metadata === "object" ? object.metadata as Record<string, unknown> : {};
  if (metadata.r12_controlled_live_test !== "1") return { handled: false as const, status: 204 };
  if (metadata.r12_merchant_entity !== expectedEntity || metadata.r12_expected_account_id !== accountId
    || typeof metadata.r12_test_run_id !== "string" || typeof event.id !== "string" || typeof event.type !== "string"
    || !Number.isSafeInteger(event.created) || !object || event.account && event.account !== accountId) {
    return { handled: true as const, status: 400 };
  }
  const isPaymentFailure = event.type === "payment_intent.payment_failed" && typeof object.id === "string" && object.id.startsWith("pi_");
  const sessionId = typeof object.id === "string" && object.id.startsWith("cs_live_") ? object.id : null;
  const paymentIntentId = isPaymentFailure ? String(object.id) : stripeObjectId(object.payment_intent);
  const amountMinor = typeof object.amount_total === "number" ? object.amount_total : typeof object.amount === "number" ? object.amount : null;
  const currency = typeof object.currency === "string" ? object.currency.toUpperCase() : null;
  const mode = typeof object.mode === "string" ? object.mode : typeof metadata.r12_checkout_mode === "string" ? metadata.r12_checkout_mode : null;
  const paymentStatus = typeof object.payment_status === "string" ? object.payment_status : isPaymentFailure && typeof object.status === "string" ? object.status : null;
  const valid = validateStripeLiveTestEvent({
    entity: expectedEntity, accountId, eventId: event.id, eventType: event.type, eventCreated: event.created as number,
    runId: metadata.r12_test_run_id, sessionId, paymentIntentId, amountMinor: amountMinor ?? (isPaymentFailure && typeof object.amount === "number" ? object.amount : null), currency, mode,
    livemode: event.livemode === true, checkoutStatus: typeof object.status === "string" ? object.status : null, paymentStatus,
  }, expectedEntity, accountId);
  if (valid !== "valid" || (!sessionId && !isPaymentFailure)) return { handled: true as const, status: 400 };
  try {
    const { error } = await adminSupabase().rpc("club_reconcile_stripe_live_test_event", {
      p_event_id: event.id,
      p_run_id: metadata.r12_test_run_id,
      p_merchant_entity: expectedEntity,
      p_account_id: accountId,
      p_event_type: event.type,
      p_event_created_at: new Date((event.created as number) * 1000).toISOString(),
      p_session_id: sessionId,
      p_payment_intent_id: paymentIntentId,
      p_amount_minor: amountMinor,
      p_currency: currency,
      p_mode: mode,
      p_livemode: event.livemode === true,
      p_payment_status: paymentStatus,
    });
    return error ? { handled: true as const, status: 500 } : { handled: true as const, status: 204 };
  } catch { return { handled: true as const, status: 500 }; }
}

