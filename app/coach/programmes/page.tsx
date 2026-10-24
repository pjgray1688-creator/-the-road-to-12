import { redirect } from "next/navigation";
import { CoachClientDestinations } from "@/components/coach-client-destinations";
import { serverSupabase } from "@/lib/supabase-server";
import { CoachReviewerDemo } from "@/components/coach-reviewer-demo";
import { hasPlayReviewerEntitlement } from "@/lib/play-reviewer";

export default async function CoachProgrammesPage() {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fcoach%2Fprogrammes");
  if (hasPlayReviewerEntitlement(user)) return <CoachReviewerDemo screen="programmes"/>;
  const { data: allowed, error: accessError } = await supabase.rpc("coach_has_access", { p_client_user_id: null });
  if (accessError || !allowed) return <main className="module-page"><section className="card"><h1>Coach access not enabled</h1><p>This R12 account does not currently have Coach access.</p></section></main>;
  const { data, error } = await supabase.rpc("coach_list_clients");
  const clients = !error && Array.isArray(data) ? data as never : [];
  return <CoachClientDestinations clients={clients} destination="programme" />;
}
