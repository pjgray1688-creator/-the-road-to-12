import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { CoachNutrition } from "@/components/coach-nutrition";
import { CoachClientDestinations } from "@/components/coach-client-destinations";
import Link from "next/link";

export default async function CoachNutritionPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const params = await searchParams;
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect(params.client ? `/account?app=coach&mode=signIn&next=${encodeURIComponent(`/coach/nutrition?client=${params.client}`)}` : "/account?app=coach&mode=signIn&next=%2Fcoach%2Fnutrition");
  if (!params.client) {
    const [{ data: allowed, error: accessError }, { data: clients, error: clientsError }] = await Promise.all([
      supabase.rpc("coach_has_access", { p_client_user_id: null }),
      supabase.rpc("coach_list_clients"),
    ]);
    if (accessError || !allowed) return <main className="module-page"><section className="card"><h1>Coach access not enabled</h1><p>This R12 account does not currently have Coach access.</p></section></main>;
    return <CoachClientDestinations clients={!clientsError && Array.isArray(clients) ? clients as never : []} destination="nutrition" />;
  }
  const client = params.client;
  const [{ data: linkedClients, error: clientsError }, { data, error }] = await Promise.all([
    supabase.rpc("coach_list_clients"),
    supabase.rpc("nutrition_get_coach_view", { p_client_user_id: client }),
  ]);
  const authorizedClient = !clientsError && Array.isArray(linkedClients)
    ? linkedClients.find((item: { clientUserId?: string; name?: string }) => item.clientUserId === client)
    : null;
  if (!authorizedClient) return <main className="module-page coach-client-unavailable"><section className="card"><h1>Client unavailable</h1><p>This client workspace is no longer available to your account.</p><Link className="secondary" href="/coach">Back to Clients</Link></section></main>;
  return <CoachNutrition clientUserId={client} clientName={authorizedClient.name ?? "Client"} initialData={error ? { activePlan: null, draftPlan: null, checkins: [], checkinDays: [], feedback: [], canManage: false } : (data ?? { activePlan: null, draftPlan: null, checkins: [], checkinDays: [], feedback: [], canManage: false })} />;
}
