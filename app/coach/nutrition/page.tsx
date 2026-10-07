import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { CoachNutrition } from "@/components/coach-nutrition";

export default async function CoachNutritionPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/account?mode=signIn&next=%2Fcoach");
  const client = (await searchParams).client;
  if (!client) return <main className="shell"><section className="card"><h1>Choose a client</h1><p>Open Nutrition from an active client in Coach.</p></section></main>;
  const { data, error } = await supabase.rpc("nutrition_get_coach_view", { p_client_user_id: client });
  return <CoachNutrition clientUserId={client} initialData={error ? { activePlan: null, draftPlan: null, checkins: [], checkinDays: [], feedback: [], canManage: false } : (data ?? { activePlan: null, draftPlan: null, checkins: [], checkinDays: [], feedback: [], canManage: false })} />;
}
