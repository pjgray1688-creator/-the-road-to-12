"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { requiresMadhouseProviderCheckout } from "@/lib/madhouse-billing";

type ActionResult = { ok: true; membershipId: string } | { ok: false; error: string };

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

export async function setMembershipHouseholdMemberAction(input: { organisationId: string; membershipId: string; customerId: string; action: "add" | "remove"; reason: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to update household membership." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "memberships.assign"))) return { ok: false, error: "You don’t have permission to change membership holders." };
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) return { ok: false, error: "Add a short reason for this family-membership change." };
    const { error } = await supabase.rpc("club_set_membership_household_member", { p_organisation_id: context.organisation.id, p_membership_id: input.membershipId, p_customer_id: input.customerId, p_action: input.action, p_reason: reason });
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

export async function createClubCustomerAction(input: { organisationId: string; displayName: string; email?: string; phone?: string }): Promise<{ ok: true; customerId: string } | { ok: false; error: string }> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to add a person." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "members.create"))) return { ok: false, error: "You don’t have permission to add people." };
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 120 || (input.email && (!input.email.includes("@") || input.email.length > 200))) return { ok: false, error: "Enter a valid name and email." };
    const existing = await context.repository.listCustomers(context.organisation.id);
    if (existing.some(customer => customer.email && input.email && customer.email.toLowerCase() === input.email.toLowerCase())) return { ok: false, error: "A person with that email is already in this organisation." };
    const customer = await context.repository.createCustomer({ organisationId: context.organisation.id, displayName, ...(input.email?.trim() ? { email: input.email.trim() } : {}), ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}), status: "guest" });
    await context.repository.appendAuditEvent({ organisationId: context.organisation.id, action: "person.created", targetType: "customer", targetId: customer.id });
    revalidatePath(`/club/members?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true, customerId: customer.id };
  } catch (error) {
    console.error("[club-members] customer creation failed", { operation: "create_customer", code: error instanceof Error && "code" in error ? error.code : undefined });
    if (error instanceof Error && "code" in error && error.code === "INVALID") return { ok: false, error: "A person with that email is already in this organisation." };
    return { ok: false, error: "Person couldn’t be added." };
  }
}
