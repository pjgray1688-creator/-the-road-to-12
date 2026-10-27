"use server";

import { redirect } from "next/navigation";
import { hasPlayReviewerEntitlement } from "@/lib/play-reviewer";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { adminSupabase } from "@/lib/supabase-admin";
import { serverSupabase } from "@/lib/supabase-server";
import { siteUrl } from "@/lib/site-url";
import { inspectStripeLiveTestApproval, readStripeMerchantConfig, stripeLiveTestApprovalSignature, stripeMerchantApiKeyFingerprint, stripeMerchantRequest, type StripeMerchantEntity } from "@/lib/stripe-merchant";
import { MADHOUSE_ORGANISATION_ID, safeStripeTestFailure, stripeLiveTestMerchants, STRIPE_LIVE_TEST_AMOUNT_MINOR } from "@/lib/stripe-live-test";

type CheckoutResponse = { id?: string; url?: string; mode?: string; livemode?: boolean; status?: string; payment_status?: string; amount_total?: number; currency?: string; subscription?: string | null; customer?: string | null };

async function startOwnerTest(entity: StripeMerchantEntity) {
  const failPath = "/club/launch-readiness/stripe/live-test?result=blocked";
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user || hasPlayReviewerEntitlement(user)) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, MADHOUSE_ORGANISATION_ID);
  if (!context || !["owner", "gym_admin"].includes(context.role) || context.organisation.id !== MADHOUSE_ORGANISATION_ID) redirect(failPath);

  let checkoutUrl: string | undefined;
  let runId: string | undefined;
  let failureOverride: string | undefined;
  try {
    // This special path remains independent of public Checkout. A mistakenly
    // enabled ordinary live gate blocks the test screen instead of broadening it.
    if (process.env.STRIPE_FRANCHISE_LIVE_ENABLED === "true" || process.env.STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED === "true") throw new Error("test_gate_blocked");
    const config = readStripeMerchantConfig(entity);
    const otherEntity = entity === "madhouse_franchise" ? "madhouse_products_services" : "madhouse_franchise";
    const other = readStripeMerchantConfig(otherEntity);
    const classWebhookSecret = process.env.STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET?.trim();
    if (config.mode !== "live" || config.accountId === other.accountId || config.webhookSecret === other.webhookSecret
      || !classWebhookSecret?.startsWith("whsec_") || classWebhookSecret === config.webhookSecret || classWebhookSecret === other.webhookSecret) throw new Error("merchant_or_webhook_configuration_blocked");
    const approval = inspectStripeLiveTestApproval(entity);
    if (approval.status !== "verified" || !approval.approval) throw new Error("signed_test_approval_blocked");
    const origin = siteUrl();

    const { data: begun, error: beginError } = await adminSupabase().rpc("club_begin_stripe_live_test", {
      p_merchant_entity: entity,
      p_account_id: config.accountId,
      p_key_fingerprint: stripeMerchantApiKeyFingerprint(config.secretKey),
      p_approval_reference: approval.approval.evidenceReference,
      p_approval_actor: approval.approval.approvedBy,
      p_observed_dashboard_name: approval.approval.observedDashboardName,
      p_observed_account_holder: approval.approval.observedAccountHolder,
      p_signed_approval: approval.approval,
      p_approval_signature: stripeLiveTestApprovalSignature(entity) ?? "",
      p_actor_id: user.id,
    });
    const reservedRunId = typeof begun === "string" ? begun : begun && typeof begun === "object" && "id" in begun ? String((begun as { id: unknown }).id) : "";
    if (beginError || !/^[0-9a-f-]{36}$/i.test(reservedRunId)) throw new Error("attempt_reservation_failed");
    runId = reservedRunId;

    const merchant = stripeLiveTestMerchants[entity];
    const form = new URLSearchParams({
      mode: "payment",
      "payment_method_types[0]": "card",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "gbp",
      "line_items[0][price_data][unit_amount]": String(STRIPE_LIVE_TEST_AMOUNT_MINOR),
      "line_items[0][price_data][product_data][name]": merchant.lineName,
      "line_items[0][price_data][product_data][description]": `One-time £1 operator test. Payment is routed to the Stripe account currently labelled ${merchant.dashboardName}; legal-entity transition remains pending.`,
      "custom_text[submit][message]": `£1 one-time test routed to the Stripe account labelled ${merchant.dashboardName}.`,
      success_url: `${origin}/club/launch-readiness/stripe/live-test?result=returned`,
      cancel_url: `${origin}/club/launch-readiness/stripe/live-test?result=cancelled`,
      expires_at: String(Math.floor(Date.now() / 1000) + 60 * 60),
      client_reference_id: runId,
      "metadata[r12_controlled_live_test]": "1",
      "metadata[r12_test_run_id]": runId,
      "metadata[r12_merchant_entity]": entity,
      "metadata[r12_expected_account_id]": config.accountId,
      "metadata[r12_approval_reference]": approval.approval.evidenceReference,
      "payment_intent_data[metadata][r12_controlled_live_test]": "1",
      "payment_intent_data[metadata][r12_test_run_id]": runId,
      "payment_intent_data[metadata][r12_merchant_entity]": entity,
      "payment_intent_data[metadata][r12_expected_account_id]": config.accountId,
      "payment_intent_data[metadata][r12_approval_reference]": approval.approval.evidenceReference,
      "payment_intent_data[metadata][r12_checkout_mode]": "payment",
    });
    const session = await stripeMerchantRequest<CheckoutResponse>(entity, "/checkout/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `r12-controlled-live-test-${runId}` },
      body: form.toString(),
    });
    if (!session.id?.startsWith("cs_live_") || !session.url || new URL(session.url).hostname !== "checkout.stripe.com"
      || session.mode !== "payment" || session.livemode !== true || session.amount_total !== STRIPE_LIVE_TEST_AMOUNT_MINOR
      || session.currency?.toUpperCase() !== "GBP" || session.subscription || session.customer) {
      failureOverride = "session_response_mismatch";
      throw new Error("session_response_mismatch");
    }
    const { error: storedError } = await adminSupabase().rpc("club_set_stripe_live_test_session", {
      p_run_id: runId, p_account_id: config.accountId, p_session_id: session.id,
    });
    if (storedError) throw new Error("session_not_durably_recorded");
    checkoutUrl = session.url;
  } catch (error) {
    // Persist only a safe classification. Never log provider messages,
    // credentials, request URLs, or authorization data.
    if (runId) try { await adminSupabase().rpc("club_fail_stripe_live_test", { p_run_id: runId, p_failure_class: failureOverride ?? safeStripeTestFailure(error) }); } catch { /* the durable claim still prevents another attempt */ }
    redirect(failPath);
  }
  if (!checkoutUrl) redirect(failPath);
  redirect(checkoutUrl);
}

export async function startFranchiseStripeLiveTestAction() { return startOwnerTest("madhouse_franchise"); }
export async function startProductsServicesStripeLiveTestAction() { return startOwnerTest("madhouse_products_services"); }
