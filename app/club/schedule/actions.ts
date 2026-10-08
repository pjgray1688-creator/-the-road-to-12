"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import type { ScheduleEventType, ScheduleStatus } from "@/lib/club-scheduling";

async function context(organisationId: string) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return undefined;
  const selected = await resolveClubOrganisationContext(supabase, user.id, organisationId);
  return selected && ["trainer", "gym_staff", "gym_admin", "owner"].includes(selected.role) ? { supabase, user, selected } : undefined;
}
export async function searchScheduleMembersAction(organisationId: string, query: string) {
  const loaded = await context(organisationId); if (!loaded || query.trim().length < 2) return [];
  const { data, error } = await loaded.supabase.rpc("club_search_schedule_members", { p_organisation_id: organisationId, p_query: query.trim() });
  if (error || !Array.isArray(data)) return [];
  return data as Array<{ id: string; name: string }>;
}
export async function searchSchedulePrivateClientsAction(organisationId: string, query: string) {
  const loaded = await context(organisationId); if (!loaded || query.trim().length < 2) return [];
  const { data, error } = await loaded.supabase.rpc("club_search_schedule_private_clients", { p_organisation_id: organisationId, p_query: query.trim() });
  if (error || !Array.isArray(data)) return [];
  return data as Array<{ id: string; name: string }>;
}
export async function createSchedulePrivateClientAction(organisationId: string, name: string) {
  const loaded = await context(organisationId); if (!loaded) return { ok: false as const, error: "Schedule access is unavailable." };
  if (name.trim().length < 2 || name.trim().length > 120) return { ok: false as const, error: "Enter a client name between 2 and 120 characters." };
  const { data, error } = await loaded.supabase.rpc("club_create_schedule_private_client", { p_organisation_id: organisationId, p_display_name: name.trim() });
  if (error || !data?.id) return { ok: false as const, error: "That private client couldn’t be added." };
  revalidatePath("/club/schedule");
  return { ok: true as const, client: { id: data.id as string, name: data.name as string } };
}
export async function saveStaffWeeklyWorkingHoursAction(organisationId: string, staffUserId: string, rows: Array<{ weekday: number; startsAt: string; endsAt: string }>) {
  const loaded = await context(organisationId); if (!loaded) return { ok: false as const, error: "Schedule access is unavailable." };
  const { error } = await loaded.supabase.rpc("club_save_staff_weekly_working_hours", { p_organisation_id: organisationId, p_staff_user_id: staffUserId, p_rows: rows });
  if (error) return { ok: false as const, error: error.code === "42501" ? "You can only manage your own working hours." : "Check each day’s start and end time, then try again." };
  revalidatePath("/club/schedule");
  return { ok: true as const };
}
export type SaveScheduleInput = { id?: string; eventType: Exclude<ScheduleEventType,"class">; staffUserId: string; customerId?: string; privateClientId?: string; locationId?: string; externalLocation?: string; title: string; notes?: string; startsAt: string; endsAt: string; status: ScheduleStatus; workingHoursOverride?: boolean; workingHoursOverrideReason?: string };
export async function saveScheduleEventAction(organisationId: string, input: SaveScheduleInput) {
  const loaded = await context(organisationId); if (!loaded) return { ok: false as const, error: "Schedule access is unavailable." };
  if (!input.title.trim() || !input.staffUserId || !Number.isFinite(Date.parse(input.startsAt)) || !Number.isFinite(Date.parse(input.endsAt)) || Date.parse(input.endsAt) <= Date.parse(input.startsAt)) return { ok: false as const, error: "Check the schedule details and try again." };
  const { error } = await loaded.supabase.rpc("club_save_schedule_event", { p_id: input.id ?? null, p_organisation_id: organisationId, p_event_type: input.eventType, p_staff_user_id: input.staffUserId, p_customer_id: input.eventType === "pt_session" ? input.customerId ?? null : null, p_private_client_id: input.eventType === "pt_session" ? input.privateClientId ?? null : null, p_location_id: input.locationId ?? null, p_external_location: input.externalLocation ?? null, p_title: input.title.trim(), p_internal_notes: input.notes ?? null, p_starts_at: input.startsAt, p_ends_at: input.endsAt, p_status: input.status, p_working_hours_override: input.workingHoursOverride ?? false, p_working_hours_override_reason: input.workingHoursOverrideReason ?? null });
  if (error) {
    const conflict = error.code === "23P01" || error.message.includes("already has a calendar item");
    return { ok: false as const, error: error.message.includes("outside the coach’s normal working hours") ? error.message : conflict ? "That PT is already booked or unavailable at this time. Choose another time or PT." : error.code === "42501" ? "You can only manage schedule items you’re authorised for." : "This schedule item couldn’t be saved." };
  }
  revalidatePath("/club/schedule"); revalidatePath("/member-hub"); revalidatePath("/member-hub/schedule");
  return { ok: true as const };
}
