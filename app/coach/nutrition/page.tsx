import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { CoachNutrition } from "@/components/coach-nutrition";
import { CoachClientDestinations } from "@/components/coach-client-destinations";

export default async function CoachNutritionPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const params = await searchParams;
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect(params.client ? `/account?mode=signIn&next=${encodeURIComponent(`/coach/nutrition?client=${params.client}`)}` : "/account?mode=signIn&next=%2Fcoach%2Fnutrition");
  if (!params.client) {
    const [{ data: allowed, error: accessError }, { data: clients, error: clientsError }] = await Promise.all([
      supabase.rpc("coach_has_access", { p_client_user_id: null }),
      supabase.rpc("coach_list_clients"),
    ]);
    if (accessError || !allowed) return <main className="module-page"><section className="card"><h1>Coach access not enabled</h1><p>This R12 account does not currently have Coach access.</p></section></main>;
    return <CoachClientDestinations clients={!clientsError && Array.isArray(clients) ? clients as never : []} destination="nutrition" />;
  }
  const client = params.client;
  const { data, error } = await supabase.rpc("nutrition_get_coach_view", { p_client_user_id: client });
  return <CoachNutrition clientUserId={client} initialData={error ? { activePlan: null, draftPlan: null, checkins: [], checkinDays: [], feedback: [], canManage: false } : (data ?? { activePlan: null, draftPlan: null, checkins: [], checkinDays: [], feedback: [], canManage: false })} />;
}
