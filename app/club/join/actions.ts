"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createGoCardlessRedirectFlow, retrieveGoCardlessRedirectFlow } from "@/lib/gocardless-join-provider";
import { siteUrl } from "@/lib/site-url";
import { createStripeCheckoutSession, retrieveStripeCheckoutSession } from "@/lib/stripe-join-provider";
import { adminSupabase } from "@/lib/supabase-admin";
import { serverSupabase } from "@/lib/supabase-server";

export type JoiningActionResult = { ok: true; requestId: string; status: string; paymentState: string; productName: string; amountMinor: number; upfrontAmountMinor: number; checkoutKind: string; billing: string; durationDays?: number } | { ok: false; error: string; existingMember?: boolean };
export type JoinDetails = {
  organisationId: string; productId: string; locationId: string; firstName: string; lastName: string;
  email: string; phone: string; dateOfBirth: string; addressLine1: string; addressLine2?: string;
  townCity?: string; postcode: string; emergencyName: string; emergencyPhone: string;
  termsAccepted: boolean; privacyAccepted: boolean; marketingConsent: boolean;
  paymentMethod: "card" | "direct_debit" | "card_and_direct_debit" | "staff_manual"; idempotencyKey: string;
};

export async function startClubJoiningAction(input: JoinDetails): Promise<JoiningActionResult> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Create or sign into your personal R12 account to continue." };
    if (!user.email_confirmed_at) return { ok: false, error: "Confirm your email before continuing." };
    const { data, error } = await supabase.rpc("club_start_membership_joining", {
      p_organisation_id: input.organisationId, p_product_id: input.productId, p_location_id: input.locationId,
      p_first_name: input.firstName, p_last_name: input.lastName, p_email: input.email, p_phone: input.phone,
      p_date_of_birth: input.dateOfBirth, p_address_line_1: input.addressLine1, p_address_line_2: input.addressLine2 ?? "",
      p_town_city: input.townCity ?? "", p_postcode: input.postcode, p_emergency_name: input.emergencyName,
      p_emergency_phone: input.emergencyPhone, p_terms_accepted: input.termsAccepted,
      p_privacy_accepted: input.privacyAccepted, p_marketing_consent: input.marketingConsent,
      p_payment_method: input.paymentMethod, p_idempotency_key: input.idempotencyKey,
    });
    if (error) return error.code === "23505"
      ? { ok: false, existingMember: true, error: "A Madhouse member record already matches this email. Use ‘I’m already a member’ so your existing membership is preserved." }
      : { ok: false, error: "Joining could not be saved. Check every required detail and try again." };
    const result = (data ?? {}) as Record<string, Record<string, unknown>>;
    const request = result.request ?? {}; const product = result.product ?? {};
    let status = String(request.status); let paymentState = String(request.payment_state);
    if (status === "ready_to_activate") {
      const activation = await supabase.rpc("club_activate_no_payment_join", { p_request_id: String(request.id) });
      if (activation.error) return { ok: false, error: "Your details are saved, but the membership could not be activated. Please resume and try again." };
      status = "active"; paymentState = "not_required";
    }
    revalidatePath("/join"); revalidatePath("/member-hub");
    return { ok: true, requestId: String(request.id), status, paymentState, productName: String(product.name), amountMinor: Number(product.price_minor), upfrontAmountMinor: Number(request.upfront_amount_minor ?? product.price_minor), checkoutKind: String(request.checkout_kind ?? "one_off"), billing: String(product.billing), ...(product.duration_days != null ? { durationDays: Number(product.duration_days) } : {}) };
  } catch { return { ok: false, error: "Joining could not be saved." }; }
}

export async function claimExistingMemberAction(organisationId: string, customerId: string) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) return { ok: false as const, error: "Sign in with a verified email first." };
  const { error } = await supabase.rpc("club_claim_existing_member", { p_organisation_id: organisationId, p_customer_id: customerId });
  if (error) return { ok: false as const, error: "This membership could not be safely matched. Ask Madhouse staff to verify and link it." };
  revalidatePath("/member-hub");
  return { ok: true as const };
}

type ProviderContext = {
  id: string; organisation_slug: string; product_name: string; currency: string; upfront_amount_minor: number;
  email: string; stripe_checkout_session_id?: string | null; stripe_checkout_generation: number;
  gocardless_redirect_flow_id?: string | null; gocardless_mandate_id?: string | null; gocardless_flow_generation: number;
};

export type ProviderActionResult = { ok: true; url?: string; pending?: boolean; message?: string } | { ok: false; error: string };

// This provider handoff replaces the former "Online payment setup is not available yet" dead end.

async function prepareProvider(requestId: string, provider: "stripe" | "gocardless", replaceReference?: string) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email_confirmed_at) throw new Error("Sign in with a verified email to continue.");
  const { data, error } = await supabase.rpc("club_prepare_join_provider_attempt", {
    p_request_id: requestId, p_provider_type: provider, p_replace_reference: replaceReference ?? null,
  });
  if (error || !data) throw new Error(provider === "stripe" ? "Card checkout is not available for this joining attempt." : "Direct Debit setup is not available for this joining attempt.");
  return data as ProviderContext;
}

async function storeProviderResource(input: { requestId: string; provider: "stripe" | "gocardless"; primaryReference: string; paymentReference?: string | null; customerReference?: string | null; bankReference?: string | null; mandateReference?: string | null }) {
  const { error } = await adminSupabase().rpc("club_store_join_provider_resource", {
    p_request_id: input.requestId, p_provider_type: input.provider, p_primary_reference: input.primaryReference,
    p_payment_reference: input.paymentReference ?? null, p_customer_reference: input.customerReference ?? null,
    p_bank_account_reference: input.bankReference ?? null, p_mandate_reference: input.mandateReference ?? null,
  });
  if (error) throw new Error("The provider session could not be linked to this joining attempt.");
}

export async function startJoinCardCheckoutAction(requestId: string): Promise<ProviderActionResult> {
  try {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe checkout is not configured");
    let context = await prepareProvider(requestId, "stripe");
    if (context.stripe_checkout_session_id) {
      const existing = await retrieveStripeCheckoutSession(context.stripe_checkout_session_id);
      if (existing.status === "open" && existing.url) return { ok: true, url: existing.url };
      if (existing.status === "complete") return { ok: true, pending: true, message: "Stripe is confirming your card payment. This page will update after the signed webhook arrives." };
      context = await prepareProvider(requestId, "stripe", context.stripe_checkout_session_id);
    }
    const base = siteUrl();
    const session = await createStripeCheckoutSession({
      requestId, generation: context.stripe_checkout_generation, email: context.email, productName: context.product_name,
      amountMinor: context.upfront_amount_minor, currency: context.currency,
      successUrl: `${base}/join/${encodeURIComponent(context.organisation_slug)}?billing=card-returned`,
      cancelUrl: `${base}/join/${encodeURIComponent(context.organisation_slug)}?billing=card-cancelled`,
    });
    if (!session.id || !session.url || session.amount_total !== context.upfront_amount_minor) throw new Error("Stripe returned an invalid checkout session.");
    await storeProviderResource({ requestId, provider: "stripe", primaryReference: session.id, paymentReference: session.payment_intent });
    return { ok: true, url: session.url };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Card checkout could not be started." };
  }
}

export async function startJoinDirectDebitAction(requestId: string): Promise<ProviderActionResult> {
  try {
    if (!process.env.GOCARDLESS_ACCESS_TOKEN) throw new Error("Direct Debit setup is not configured");
    let context = await prepareProvider(requestId, "gocardless");
    if (context.gocardless_mandate_id) return { ok: true, pending: true, message: "GoCardless is confirming your Direct Debit mandate." };
    const cookieStore = await cookies();
    const cookieName = `r12_gc_${requestId}`;
    const stored = cookieStore.get(cookieName)?.value;
    let saved: { flowId: string; token: string } | undefined;
    try { saved = stored ? JSON.parse(stored) as { flowId: string; token: string } : undefined; } catch { saved = undefined; }
    if (context.gocardless_redirect_flow_id && saved?.flowId === context.gocardless_redirect_flow_id && saved.token) {
      const existing = await retrieveGoCardlessRedirectFlow(context.gocardless_redirect_flow_id);
      if (existing.links?.mandate) return { ok: true, pending: true, message: "GoCardless is confirming your Direct Debit mandate." };
      if (existing.redirect_url) return { ok: true, url: existing.redirect_url };
    }
    if (context.gocardless_redirect_flow_id) context = await prepareProvider(requestId, "gocardless", context.gocardless_redirect_flow_id);
    const token = randomUUID();
    const flow = await createGoCardlessRedirectFlow({
      requestId, generation: context.gocardless_flow_generation, sessionToken: token,
      description: `${context.product_name} recurring Direct Debit`,
      successUrl: `${siteUrl()}/api/club/join/gocardless/complete?request_id=${encodeURIComponent(requestId)}`,
    });
    if (!flow.id || !flow.redirect_url) throw new Error("GoCardless returned an invalid mandate flow.");
    await storeProviderResource({ requestId, provider: "gocardless", primaryReference: flow.id });
    cookieStore.set(cookieName, JSON.stringify({ flowId: flow.id, token }), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
    return { ok: true, url: flow.redirect_url };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Direct Debit setup could not be started." };
  }
}

export async function retryJoinPaymentAction(requestId: string, step: "card" | "direct_debit" = "card") {
  return step === "card" ? startJoinCardCheckoutAction(requestId) : startJoinDirectDebitAction(requestId);
}
