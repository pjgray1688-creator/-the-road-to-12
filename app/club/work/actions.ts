"use server";
import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { calculateShiftMinutes } from "@/lib/club-finance";
export async function submitShiftAction(formData: FormData) {
  const organisationId = String(formData.get("organisationId") ?? ""); const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user || !organisationId) return;
  const start = String(formData.get("start") ?? ""); const finish = String(formData.get("finish") ?? ""); const breakMinutes = Number(formData.get("break") ?? 0); let durationMinutes: number; try { durationMinutes = calculateShiftMinutes(start, finish, breakMinutes); } catch { return; }
  await client.rpc("club_finance_submit_shift", { p_organisation_id: organisationId, p_work_date: String(formData.get("workDate") ?? ""), p_start_time: start, p_finish_time: finish, p_break_minutes: breakMinutes, p_duration_minutes: durationMinutes, p_note: String(formData.get("note") ?? "") || null }); revalidatePath("/club/work");
}
export async function submitWorkAction(formData: FormData) {
  const organisationId = String(formData.get("organisationId") ?? ""); const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user || !organisationId) return;
  await client.rpc("club_finance_submit_work", { p_organisation_id: organisationId, p_work_type: String(formData.get("workType") ?? "hours"), p_work_date: String(formData.get("workDate") ?? ""), p_duration_minutes: formData.get("duration") ? Number(formData.get("duration")) : null, p_amount_minor: formData.get("amount") ? Math.round(Number(formData.get("amount")) * 100) : null, p_collector: null, p_note: String(formData.get("note") ?? "") || null });
  revalidatePath("/club/work");
}
export async function reviewWorkAction(formData: FormData) {
  const organisationId = String(formData.get("organisationId") ?? ""); const id = String(formData.get("id") ?? ""); const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user || !id) return; const context = await resolveClubOperationalContext(client, user.id, organisationId); if (!context || !["gym_admin", "owner"].includes(context.role)) return;
  await client.rpc("club_finance_review_work", { p_work_id: id, p_status: String(formData.get("status") ?? "queried"), p_manager_note: String(formData.get("note") ?? "") || null }); revalidatePath("/club/work");
}
