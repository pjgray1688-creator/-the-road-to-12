"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";

export async function saveInductionPolicyAction(input: { organisationId: string; requirement: "none" | "online_or_in_person" | "in_person"; graceDays: number; overdueAccess: "allow" | "hold"; appointmentExtensionEnabled: boolean; maxAppointmentExtensionDays?: number; requiresReacknowledgement: boolean }) {
  try {
    const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) return { ok: false as const, error: "Sign in to manage induction." };
    const context = await resolveClubOperationalContext(supabase, user.id, input.organisationId);
    if (!context || !["gym_admin", "owner"].includes(context.role)) return { ok: false as const, error: "You don’t have permission to manage induction." };
    if (!Number.isInteger(input.graceDays) || input.graceDays < 0 || (input.maxAppointmentExtensionDays !== undefined && (!Number.isInteger(input.maxAppointmentExtensionDays) || input.maxAppointmentExtensionDays < 0))) return { ok: false as const, error: "Check the induction settings." };
    await context.repository.saveInductionPolicy({ organisationId: context.organisation.id, requirement: input.requirement, graceDays: input.graceDays, overdueAccess: input.overdueAccess, appointmentExtensionEnabled: input.appointmentExtensionEnabled, maxAppointmentExtensionDays: input.maxAppointmentExtensionDays, requiresReacknowledgement: input.requiresReacknowledgement, active: input.requirement !== "none" });
    revalidatePath(`/club/induction?org=${encodeURIComponent(input.organisationId)}`); return { ok: true as const };
  } catch { return { ok: false as const, error: "Induction settings couldn’t be saved." }; }
}
