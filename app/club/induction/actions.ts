"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";

export async function saveInductionPolicyAction(input: { organisationId: string; requirement: "none" | "online_or_in_person" | "in_person"; graceDays: number; overdueAccess: "allow" | "hold"; appointmentExtensionEnabled: boolean; maxAppointmentExtensionDays?: number; requiresReacknowledgement: boolean }) {
  try {
    const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return { ok: false as const, error: "Sign in to manage induction." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "induction.manage_policy"))) return { ok: false as const, error: "You don’t have permission to manage induction." };
    if (!Number.isInteger(input.graceDays) || input.graceDays < 0 || (input.maxAppointmentExtensionDays !== undefined && (!Number.isInteger(input.maxAppointmentExtensionDays) || input.maxAppointmentExtensionDays < 0))) return { ok: false as const, error: "Check the induction settings." };
    await context.repository.saveInductionPolicy({ organisationId: context.organisation.id, requirement: input.requirement, graceDays: input.graceDays, overdueAccess: input.overdueAccess, appointmentExtensionEnabled: input.appointmentExtensionEnabled, maxAppointmentExtensionDays: input.maxAppointmentExtensionDays, requiresReacknowledgement: input.requiresReacknowledgement, active: input.requirement !== "none" });
    revalidatePath(`/club/induction?org=${encodeURIComponent(input.organisationId)}`); return { ok: true as const };
  } catch { return { ok: false as const, error: "Induction settings couldn’t be saved." }; }
}

export async function completeInductionBookingAction(input: { organisationId: string; bookingId: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to record induction completion." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "induction.perform"))) return { ok: false, error: "You don’t have permission to record induction completion." };
    const { error } = await supabase.rpc("club_reconcile_induction_booking", { p_organisation_id: context.organisation.id, p_booking_id: input.bookingId, p_status: "completed" });
    if (error) return { ok: false, error: error.code === "42501" ? "You aren’t authorised at this induction location." : "This induction booking could not be completed." };
    revalidatePath(`/club/induction?org=${encodeURIComponent(context.organisation.id)}`);
    revalidatePath(`/club/members?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Induction completion couldn’t be recorded." };
  }
}

export async function recordCustomerInductionCompletionAction(input: { organisationId: string; customerId: string; locationId: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await serverSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to record induction completion." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "induction.perform"))) return { ok: false, error: "You don’t have permission to record induction completion." };
    const { error } = await supabase.rpc("club_record_customer_induction_completion", { p_organisation_id: context.organisation.id, p_customer_id: input.customerId, p_location_id: input.locationId });
    if (error) return { ok: false, error: error.code === "42501" ? "You aren’t authorised at this induction location." : "Induction completion could not be recorded." };
    revalidatePath(`/club/induction?org=${encodeURIComponent(context.organisation.id)}`);
    revalidatePath(`/club/members?org=${encodeURIComponent(context.organisation.id)}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Induction completion couldn’t be recorded." };
  }
}
