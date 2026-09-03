"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";

type ActionResult = { ok: true; membershipId: string } | { ok: false; error: string };

export async function assignMembershipAction(input: { organisationId: string; productId: string; holderUserIds?: string[]; customerId?: string; startsAt: string; endsAt?: string; idempotencyKey?: string }): Promise<ActionResult> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to manage memberships." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !["gym_admin", "owner"].includes(context.role)) return { ok: false, error: "You don’t have permission to assign memberships." };
    const holders = [...new Set((input.holderUserIds ?? []).filter(Boolean))];
    if (!input.productId || (!holders.length && !input.customerId) || !Number.isFinite(Date.parse(input.startsAt)) || (input.endsAt && (!Number.isFinite(Date.parse(input.endsAt)) || Date.parse(input.endsAt) <= Date.parse(input.startsAt)))) return { ok: false, error: "Check the membership details and dates." };
    const products = await context.repository.listProducts(context.organisation.id, true);
    const product = products.find(item => item.id === input.productId && item.organisationId === context.organisation.id && item.kind === "membership" && !item.archivedAt);
    if (!product) return { ok: false, error: "Choose an available membership or pass." };
    const members = await context.repository.listMembers(context.organisation.id);
    if (holders.some(holder => !members.some(member => member.userId === holder && member.active))) return { ok: false, error: "Every holder must be an active organisation member." };
    if (input.customerId) {
      const customers = await context.repository.listCustomers(context.organisation.id);
      if (!customers.some(customer => customer.id === input.customerId)) return { ok: false, error: "Choose a person from this organisation." };
    }
    const start = new Date(input.startsAt); const derivedEnd = !input.endsAt && product.durationDays ? new Date(start.getTime() + product.durationDays * 86400000).toISOString() : input.endsAt ? new Date(input.endsAt).toISOString() : undefined;
    const result = await context.repository.assignMembership({ organisationId: context.organisation.id, productId: product.id, customerId: input.customerId, holderUserIds: holders, source: "staff_assignment", validity: { startsAt: start.toISOString(), ...(derivedEnd ? { endsAt: derivedEnd } : {}) }, idempotencyKey: input.idempotencyKey ?? crypto.randomUUID() });
    revalidatePath(`/club/members?org=${encodeURIComponent(context.organisation.id)}`);
    if (holders[0]) revalidatePath(`/club/members/${encodeURIComponent(holders[0])}?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true, membershipId: result.membership.id };
  } catch (error) {
    console.error("[club-members] membership assignment failed", { operation: "assign_membership", code: error instanceof Error && "code" in error ? error.code : undefined });
    return { ok: false, error: "Membership couldn’t be assigned." };
  }
}

export async function linkClubCustomerAction(input: { organisationId: string; customerId: string; userId: string }): Promise<{ ok: boolean; error?: string }> {
  try { const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return { ok: false, error: "Sign in to link an account." }; const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId); if (!context || !["gym_staff", "gym_admin", "owner"].includes(context.role)) return { ok: false, error: "You don’t have permission to link accounts." }; await context.repository.linkCustomerUser(input.customerId, input.userId); revalidatePath(`/club/members?org=${encodeURIComponent(context.organisation.id)}`); return { ok: true }; } catch { return { ok: false, error: "That account could not be linked." }; }
}

export async function endMembershipAction(input: { organisationId: string; membershipId: string; effectiveAt?: string; status?: "cancelled" | "expired" }): Promise<ActionResult> {
  try {
    const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to manage memberships." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !["gym_admin", "owner"].includes(context.role)) return { ok: false, error: "You don’t have permission to end memberships." };
    const membership = await context.repository.endMembership({ organisationId: context.organisation.id, membershipId: input.membershipId, effectiveAt: input.effectiveAt, status: input.status });
    revalidatePath(`/club/members?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true, membershipId: membership.id };
  } catch (error) { console.error("[club-members] membership end failed", { operation: "end_membership" }); return { ok: false, error: "Membership couldn’t be ended." }; }
}

export async function createClubCustomerAction(input: { organisationId: string; displayName: string; email?: string; phone?: string }): Promise<{ ok: true; customerId: string } | { ok: false; error: string }> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to add a person." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !["gym_staff", "gym_admin", "owner"].includes(context.role)) return { ok: false, error: "You don’t have permission to add people." };
    const displayName = input.displayName.trim();
    if (!displayName || displayName.length > 120 || (input.email && (!input.email.includes("@") || input.email.length > 200))) return { ok: false, error: "Enter a valid name and email." };
    const existing = await context.repository.listCustomers(context.organisation.id);
    if (existing.some(customer => customer.email && input.email && customer.email.toLowerCase() === input.email.toLowerCase())) return { ok: false, error: "A person with that email is already in this organisation." };
    const customer = await context.repository.createCustomer({ organisationId: context.organisation.id, displayName, ...(input.email?.trim() ? { email: input.email.trim() } : {}), ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}), status: "guest" });
    revalidatePath(`/club/members?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true, customerId: customer.id };
  } catch (error) {
    console.error("[club-members] customer creation failed", { operation: "create_customer", code: error instanceof Error && "code" in error ? error.code : undefined });
    return { ok: false, error: "Person couldn’t be added." };
  }
}
