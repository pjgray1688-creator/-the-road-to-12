"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { requiresMadhouseProviderCheckout } from "@/lib/madhouse-billing";
import { nudgeNotificationWorker } from "@/lib/notification-nudge";

type ActionResult = { ok: true; membershipId: string } | { ok: false; error: string };

export async function initiateMembershipCounterPaymentAction(input: { organisationId: string; productId: string; customerId: string; locationId: string; method: "cash" | "bank_transfer" | "external_card"; externalReference?: string; terminalSuccessConfirmed?: boolean; evidenceNote: string; startsAt: string; paymentReceivedAt: string; idempotencyKey: string }): Promise<{ ok: boolean; paymentId?: string; provisionalExpiresAt?: string; error?: string }> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to record a membership payment." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "payments.take"))) return { ok: false, error: "You don’t have permission to initiate membership payments." };
    if (!input.locationId || !input.productId || !input.customerId || !Number.isFinite(Date.parse(input.startsAt)) || !Number.isFinite(Date.parse(input.paymentReceivedAt)) || input.evidenceNote.trim().length < 8 || (input.method === "bank_transfer" && !input.externalReference?.trim()) || (input.method === "external_card" && !input.terminalSuccessConfirmed)) return { ok: false, error: "Choose a venue and record the required payment evidence." };
    const { data, error } = await supabase.rpc("club_initiate_membership_counter_payment", { p_organisation_id: context.organisation.id, p_product_id: input.productId, p_customer_id: input.customerId, p_location_id: input.locationId, p_method: input.method, p_external_reference: input.externalReference?.trim() || null, p_terminal_success_confirmed: input.terminalSuccessConfirmed === true, p_evidence_note: input.evidenceNote.trim(), p_starts_at: new Date(input.startsAt).toISOString(), p_payment_received_at: new Date(input.paymentReceivedAt).toISOString(), p_idempotency_key: input.idempotencyKey });
    if (error) return { ok: false, error: error.code === "42501" ? "This payment method or venue is not authorised for your account." : error.code === "23505" ? "This payment evidence is already recorded." : "Payment evidence could not be recorded. No membership was activated." };
    revalidatePath("/club/members", "layout");
    return { ok: true, paymentId: data && typeof data === "object" && "id" in data ? String(data.id) : undefined, provisionalExpiresAt: data && typeof data === "object" && "provisional_expires_at" in data && data.provisional_expires_at ? String(data.provisional_expires_at) : undefined };
  } catch { return { ok: false, error: "Payment evidence could not be recorded. No membership was activated." }; }
}

export async function verifyMembershipCounterPaymentAction(input: { organisationId: string; paymentId: string; decision: "confirmed" | "rejected"; verificationNote: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to verify membership payments." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "membership_payments.verify")) || !(await context.repository.hasCapability(context.organisation.id, user.id, "memberships.assign"))) return { ok: false, error: "You don’t have permission to verify and activate membership payments." };
    if (input.verificationNote.trim().length < 8) return { ok: false, error: "Record how the payment evidence was verified." };
    const { error } = await supabase.rpc("club_verify_membership_counter_payment", { p_organisation_id: context.organisation.id, p_payment_id: input.paymentId, p_decision: input.decision, p_verification_note: input.verificationNote.trim() });
    if (error) return { ok: false, error: error.code === "42501" ? "Payment verification is not authorised." : "The payment could not be verified; no access was activated." };
    revalidatePath("/club/members", "layout"); return { ok: true };
  } catch { return { ok: false, error: "The payment could not be verified; no access was activated." }; }
}

export async function correctMembershipCounterPaymentAction(input: { organisationId: string; paymentId: string; correctionType: "reversed" | "evidence_correction_required"; reason: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to correct payment records." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "finance.manage"))) return { ok: false, error: "Financial correction permission is required." };
    if (input.reason.trim().length < 8) return { ok: false, error: "Record a clear correction reason." };
    const { error } = await supabase.rpc("club_correct_membership_counter_payment", { p_organisation_id: context.organisation.id, p_payment_id: input.paymentId, p_correction_type: input.correctionType, p_reason: input.reason.trim() });
    if (error) return { ok: false, error: error.code === "23505" ? "That correction is already recorded." : "The correction could not be recorded; original evidence was preserved." };
    revalidatePath("/club/payments/membership", "page"); return { ok: true };
  } catch { return { ok: false, error: "The correction could not be recorded; original evidence was preserved." }; }
}

export async function setFamilyContractTermsAction(input: { organisationId: string; membershipId: string; amountMinor: number; frequency: "weekly" | "monthly" | "quarterly" | "annual" | "other"; paidThroughDate?: string; billingState: "pending" | "active" | "paused" | "ended"; reason: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to manage Family contract terms." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "memberships.pricing_sensitive"))) return { ok: false, error: "Sensitive Family pricing permission is required." };
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0 || input.reason.trim().length < 8) return { ok: false, error: "Enter the agreed positive amount and a clear source-record note." };
    const { error } = await supabase.rpc("club_set_family_contract_terms", { p_organisation_id: context.organisation.id, p_membership_id: input.membershipId, p_amount_minor: input.amountMinor, p_currency: "GBP", p_frequency: input.frequency, p_paid_through_date: input.paidThroughDate || null, p_billing_state: input.billingState, p_reason: input.reason.trim() });
    if (error) return { ok: false, error: error.code === "42501" ? "Sensitive Family pricing permission is required." : "Family terms could not be saved; no billing or access was changed." };
    revalidatePath("/club/memberships", "page"); return { ok: true };
  } catch { return { ok: false, error: "Family terms could not be saved; no billing or access was changed." }; }
}

export async function extendMembershipPaymentGraceAction(input: { organisationId: string; obligationId: string; newGraceExpiresAt: string; agreedPaymentDate?: string; reason: string; idempotencyKey: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to manage payment grace." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "payments.extend_grace"))) return { ok: false, error: "You don’t have permission to extend payment grace." };
    const expiry = Date.parse(input.newGraceExpiresAt);
    const reason = input.reason.trim();
    if (!Number.isFinite(expiry) || expiry <= Date.now() || reason.length < 8 || reason.length > 500 || !input.idempotencyKey) return { ok: false, error: "Choose a future grace expiry and record a clear reason." };
    const { error } = await supabase.rpc("club_extend_membership_payment_grace", { p_organisation_id: context.organisation.id, p_obligation_id: input.obligationId, p_new_grace_expires_at: new Date(expiry).toISOString(), p_agreed_payment_date: input.agreedPaymentDate ?? null, p_reason: reason, p_idempotency_key: input.idempotencyKey });
    if (error) {
      if (error.code === "42501") return { ok: false, error: "You don’t have permission to extend payment grace." };
      if (error.code === "P0002") return { ok: false, error: "That payment obligation is no longer available." };
      if (error.code === "23505") return { ok: false, error: "This extension was already recorded. Refresh the profile." };
      return { ok: false, error: error.message.includes("later than") ? "The new expiry must be later than the current grace expiry." : error.message.includes("eligible") ? "Only a failed or overdue unpaid obligation can be extended." : "Payment grace couldn’t be extended. Refresh and check the dates." };
    }
    revalidatePath("/club/members", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "Payment grace couldn’t be extended." };
  }
}

export async function assignMembershipAction(input: { organisationId: string; productId: string; holderUserIds?: string[]; customerId?: string; startsAt: string; endsAt?: string; idempotencyKey?: string }): Promise<ActionResult> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to manage memberships." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "memberships.assign"))) return { ok: false, error: "You don’t have permission to assign memberships." };
    const holders = [...new Set((input.holderUserIds ?? []).filter(Boolean))];
    if (!input.productId || (!holders.length && !input.customerId) || !Number.isFinite(Date.parse(input.startsAt)) || (input.endsAt && (!Number.isFinite(Date.parse(input.endsAt)) || Date.parse(input.endsAt) <= Date.parse(input.startsAt)))) return { ok: false, error: "Check the membership details and dates." };
    const products = await context.repository.listProducts(context.organisation.id, true);
    const product = products.find(item => item.id === input.productId && item.organisationId === context.organisation.id && item.kind === "membership" && !item.archivedAt);
    if (!product) return { ok: false, error: "Choose an available membership or pass." };
    if (product.isLifetime && input.endsAt) return { ok: false, error: "Golden Ticket — Lifetime Membership cannot have an end date. Remove the end date and try again." };
    if (product.pricingOnRequest) return { ok: false, error: "Family Membership requires authorised negotiated contract terms before activation." };
    if (requiresMadhouseProviderCheckout(context.organisation.slug, product)) return { ok: false, error: "Paid Madhouse memberships must use the joining checkout so card payment and Direct Debit setup are confirmed before activation." };
    const members = await context.repository.listMembers(context.organisation.id);
    if (holders.some(holder => !members.some(member => member.userId === holder && member.active))) return { ok: false, error: "Every holder must be an active organisation member." };
    if (input.customerId) {
      const customers = await context.repository.listCustomers(context.organisation.id);
      if (!customers.some(customer => customer.id === input.customerId)) return { ok: false, error: "Choose a person from this organisation." };
    }
    const start = new Date(input.startsAt); const derivedEnd = !input.endsAt && product.durationDays ? new Date(start.getTime() + product.durationDays * 86400000).toISOString() : input.endsAt ? new Date(input.endsAt).toISOString() : undefined;
    const result = await context.repository.assignMembership({ organisationId: context.organisation.id, productId: product.id, customerId: input.customerId, holderUserIds: holders, source: "staff_assignment", validity: { startsAt: start.toISOString(), ...(derivedEnd ? { endsAt: derivedEnd } : {}) }, idempotencyKey: input.idempotencyKey ?? crypto.randomUUID() });
    await context.repository.appendAuditEvent({ organisationId: context.organisation.id, action: "membership.assigned", targetType: "membership", targetId: result.membership.id });
    revalidatePath(`/club/members?org=${encodeURIComponent(context.organisation.id)}`);
    if (holders[0]) revalidatePath(`/club/members/${encodeURIComponent(holders[0])}?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true, membershipId: result.membership.id };
  } catch (error) {
    console.error("[club-members] membership assignment failed", { operation: "assign_membership", code: error instanceof Error && "code" in error ? error.code : undefined });
    return { ok: false, error: "Membership couldn’t be assigned." };
  }
}

export async function linkClubCustomerAction(input: { organisationId: string; customerId: string; targetEmail: string; verificationMethod: "photo_id" | "membership_reference" | "in_person"; reason: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to link an account." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "members.link_account"))) return { ok: false, error: "You don’t have permission to link accounts." };
    if (!input.targetEmail.includes("@") || input.reason.trim().length < 8) return { ok: false, error: "Enter the member’s verified R12 email and how their identity was checked." };
    const { error } = await supabase.rpc("club_staff_link_member_account", { p_organisation_id: context.organisation.id, p_customer_id: input.customerId, p_target_email: input.targetEmail.trim(), p_verification_method: input.verificationMethod, p_reason: input.reason.trim() });
    if (error) return { ok: false, error: "The account could not be safely linked. Confirm the verified R12 email and that it is not linked elsewhere." };
    revalidatePath(`/club/members?org=${encodeURIComponent(context.organisation.id)}`);
    revalidatePath(`/club/members/customer/${encodeURIComponent(input.customerId)}?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "That account could not be linked." };
  }
}

export async function resendMemberActivationAction(input: { organisationId: string; customerId: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to resend an activation email." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "members.link_account"))) return { ok: false, error: "You don’t have permission to manage member account links." };
    const { error } = await supabase.rpc("club_resend_member_activation_notification", { p_organisation_id: context.organisation.id, p_customer_id: input.customerId });
    if (error) return { ok: false, error: "Activation could not be queued. Check that this person has an email and no linked R12 account." };
    nudgeNotificationWorker();
    revalidatePath(`/club/members/customer/${encodeURIComponent(input.customerId)}?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true };
  } catch { return { ok: false, error: "Activation could not be queued." }; }
}

export async function verifyMemberPersonalEmailAction(input: { organisationId: string; customerId: string; email: string; method: "in_person" | "member_confirmed"; note: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to verify a member email." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "members.link_account"))) return { ok: false, error: "You don’t have permission to verify member emails." };
    if (!input.email.trim().includes("@") || input.note.trim().length < 8) return { ok: false, error: "Enter the member’s own email and how they confirmed control of it." };
    const { error } = await supabase.rpc("club_verify_member_personal_email", { p_organisation_id: context.organisation.id, p_customer_id: input.customerId, p_email: input.email.trim(), p_method: input.method, p_note: input.note.trim() });
    if (error) return { ok: false, error: "Email verification could not be recorded. Confirm the address matches this member’s current record." };
    revalidatePath(`/club/members/customer/${encodeURIComponent(input.customerId)}?org=${encodeURIComponent(context.organisation.id)}`);
    revalidatePath(`/club/members/import?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true };
  } catch { return { ok: false, error: "Email verification could not be recorded." }; }
}

export async function endMembershipAction(input: { organisationId: string; membershipId: string; effectiveAt?: string; status?: "cancelled" | "expired" }): Promise<ActionResult> {
  try {
    const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to manage memberships." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "memberships.assign"))) return { ok: false, error: "You don’t have permission to end memberships." };
    const effectiveAt = input.effectiveAt ? Date.parse(input.effectiveAt) : Date.now();
    if (!Number.isFinite(effectiveAt)) return { ok: false, error: "Choose a valid end date." };
    if (effectiveAt <= Date.now() && !(await context.repository.hasCapability(context.organisation.id, user.id, "memberships.end_immediately"))) return { ok: false, error: "You don’t have permission to end memberships immediately." };
    const membership = await context.repository.endMembership({ organisationId: context.organisation.id, membershipId: input.membershipId, effectiveAt: input.effectiveAt, status: input.status });
    await context.repository.appendAuditEvent({ organisationId: context.organisation.id, action: "membership.end_requested", targetType: "membership", targetId: membership.id });
    revalidatePath(`/club/members?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true, membershipId: membership.id };
  } catch (error) { console.error("[club-members] membership end failed", { operation: "end_membership" }); return { ok: false, error: "Membership couldn’t be ended." }; }
}

export async function setMembershipAccessStatusAction(input: { organisationId: string; membershipId: string; status: "active" | "paused"; reason: string }): Promise<ActionResult> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to change membership access." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "memberships.end_immediately"))) return { ok: false, error: "You don’t have permission to pause or reactivate membership access." };
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) return { ok: false, error: "Add a short reason for this access change." };
    const { error } = await supabase.rpc("club_set_membership_access_status", { p_organisation_id: context.organisation.id, p_membership_id: input.membershipId, p_status: input.status, p_reason: reason });
    if (error) {
      if (error.code === "42501") return { ok: false, error: "You don’t have permission to change this membership’s access." };
      if (error.code === "P0002") return { ok: false, error: "Membership not found in this organisation." };
      if (error.code === "22023") return { ok: false, error: error.message.includes("expired") ? "This membership has expired and cannot be reactivated." : error.message.includes("not started") ? "This membership has not started yet." : "This membership can’t be changed to that access state." };
      return { ok: false, error: "Membership access couldn’t be updated." };
    }
    revalidatePath(`/club/members?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true, membershipId: input.membershipId };
  } catch {
    return { ok: false, error: "Membership access couldn’t be updated." };
  }
}

export async function setMembershipHouseholdMemberAction(input: { organisationId: string; membershipId: string; customerId: string; action: "add" | "remove"; reason: string; coverageRole: "adult" | "child" | "other" }): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to update household membership." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "memberships.assign"))) return { ok: false, error: "You don’t have permission to change membership holders." };
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) return { ok: false, error: "Add a short reason for this family-membership change." };
    const { error } = await supabase.rpc("club_set_membership_household_member", { p_organisation_id: context.organisation.id, p_membership_id: input.membershipId, p_customer_id: input.customerId, p_action: input.action, p_reason: reason, p_coverage_role: input.coverageRole });
    if (error) {
      if (error.code === "42501") return { ok: false, error: "You don’t have permission to change membership holders." };
      if (error.code === "P0002") return { ok: false, error: "The membership or person could not be found in this organisation." };
      if (error.code === "23505") return { ok: false, error: "That person is already included in this membership." };
      if (error.code === "22023") return { ok: false, error: error.message.includes("billing contact") ? "Resolve the recorded billing contact before removing this person." : error.message.includes("at least one holder") ? "A membership must keep at least one holder." : "That family-membership change can’t be completed." };
      return { ok: false, error: "Membership holders couldn’t be updated." };
    }
    revalidatePath(`/club/members?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Membership holders couldn’t be updated." };
  }
}

export async function verifyMembershipEligibilityAction(input: { organisationId: string; joinRequestId: string; status: "approved" | "rejected"; evidenceNote: string }): Promise<{ ok: boolean; error: string }> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to verify membership eligibility." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "memberships.assign"))) return { ok: false, error: "You don’t have permission to verify membership eligibility." };
    const evidenceNote = input.evidenceNote.trim();
    if (evidenceNote.length < 3 || evidenceNote.length > 500) return { ok: false, error: "Record a short evidence note before saving." };
    const { error } = await supabase.rpc("club_verify_membership_eligibility", { p_organisation_id: context.organisation.id, p_join_request_id: input.joinRequestId, p_status: input.status, p_evidence_note: evidenceNote });
    if (error) return { ok: false, error: error.code === "42501" ? "You don’t have permission to verify membership eligibility." : error.code === "P0002" ? "This joining request can no longer be verified." : "Eligibility verification couldn’t be saved." };
    revalidatePath(`/club/members?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true, error: "" };
  } catch {
    return { ok: false, error: "Eligibility verification couldn’t be saved." };
  }
}

export async function createClubCustomerAction(input: { organisationId: string; displayName: string; email?: string; phone?: string }): Promise<{ ok: true; customerId: string } | { ok: false; error: string }> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to add a person." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "members.create"))) return { ok: false, error: "You don’t have permission to add people." };
    const displayName = input.displayName.trim();
    const email = input.email?.trim();
    if (!displayName || displayName.length > 120 || !email || !email.includes("@") || email.length > 200) return { ok: false, error: "A valid email is required for a new member." };
    const existing = await context.repository.listCustomers(context.organisation.id);
    if (existing.some(customer => customer.email && customer.email.toLowerCase() === email.toLowerCase())) return { ok: false, error: "A person with that email is already in this organisation." };
    const customer = await context.repository.createCustomer({ organisationId: context.organisation.id, displayName, email, ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}), status: "guest" });
    await context.repository.appendAuditEvent({ organisationId: context.organisation.id, action: "person.created", targetType: "customer", targetId: customer.id });
    revalidatePath(`/club/members?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true, customerId: customer.id };
  } catch (error) {
    console.error("[club-members] customer creation failed", { operation: "create_customer", code: error instanceof Error && "code" in error ? error.code : undefined });
    if (error instanceof Error && "code" in error && error.code === "INVALID") return { ok: false, error: "A person with that email is already in this organisation." };
    return { ok: false, error: "Person couldn’t be added." };
  }
}
