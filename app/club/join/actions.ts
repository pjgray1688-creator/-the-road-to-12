"use server";

import { revalidatePath } from "next/cache";
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

export async function retryJoinPaymentAction(requestId: string) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Sign in to continue." };
  const { error } = await supabase.rpc("club_retry_join_payment", { p_request_id: requestId });
  if (error) return { ok: false as const, error: "Payment retry is unavailable for this request." };
  return { ok: false as const, error: "Online payment setup is not available yet. Your place is saved; no payment or membership activation has been recorded." };
}
