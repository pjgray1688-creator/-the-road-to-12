"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";

type SetupResult = { ok: true; result: Record<string, unknown> } | { ok: false; error: string };
const validWindow = (from: string, to: string) => /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && Date.parse(`${to}T00:00:00Z`) >= Date.parse(`${from}T00:00:00Z`) && Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) <= 366 * 86400000;

export async function generateMadhouseClassSessionsAction(input: { organisationId: string; from: string; to: string }): Promise<SetupResult> {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user || !validWindow(input.from, input.to)) return { ok: false, error: "Choose a valid future date window of no more than one year." };
  const context = await resolveClubOrganisationContext(supabase, user.id, input.organisationId);
  if (!context || !["gym_admin", "owner"].includes(context.role)) return { ok: false, error: "Class schedule generation is restricted to Club management." };
  const { data, error } = await supabase.rpc("club_madhouse_generate_class_sessions", { p_organisation_id: context.organisation.id, p_from: input.from, p_to: input.to });
  if (error || !data) return { ok: false, error: error?.message ?? "Class sessions could not be generated." };
  revalidatePath("/club/classes"); return { ok: true, result: data as Record<string, unknown> };
}

export async function generateMadhouseRotaAction(input: { organisationId: string; from: string; to: string }): Promise<SetupResult> {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user || !validWindow(input.from, input.to)) return { ok: false, error: "Choose a valid future date window of no more than one year." };
  const context = await resolveClubOrganisationContext(supabase, user.id, input.organisationId);
  if (!context || !["gym_admin", "owner"].includes(context.role)) return { ok: false, error: "Rota generation is restricted to Club management." };
  const { data, error } = await supabase.rpc("club_madhouse_generate_rota", { p_organisation_id: context.organisation.id, p_from: input.from, p_to: input.to });
  if (error || !data) return { ok: false, error: error?.message ?? "Staff rota could not be generated." };
  revalidatePath("/club/schedule"); return { ok: true, result: data as Record<string, unknown> };
}

export async function seedMadhouseDailyChecksAction(organisationId: string): Promise<SetupResult> {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in to prepare Club checks." };
  const context = await resolveClubOrganisationContext(supabase, user.id, organisationId);
  if (!context || !["gym_admin", "owner"].includes(context.role)) return { ok: false, error: "Daily-check setup is restricted to Club management." };
  const { data, error } = await supabase.rpc("club_madhouse_seed_daily_checks", { p_organisation_id: context.organisation.id });
  if (error || !data) return { ok: false, error: error?.message ?? "Daily checks could not be prepared." };
  revalidatePath("/club/checks"); return { ok: true, result: data as Record<string, unknown> };
}
