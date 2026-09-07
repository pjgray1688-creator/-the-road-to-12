"use server";
import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
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
