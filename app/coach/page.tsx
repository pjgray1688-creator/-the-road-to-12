import { CoachWorkspace } from "@/components/coach-workspace";
import { AppNav } from "@/components/app-nav";
import { authenticatedServerClient } from "@/lib/require-user";
import { TutorialExperience } from "@/components/tutorial-experience";
import type { CoachWorkspaceSection } from "@/components/coach-client-workspace";
import { listClubOrganisationContexts } from "@/lib/club-server-context";
import { londonDateKey, type ScheduleEvent } from "@/lib/club-scheduling";

export default async function CoachPage({ searchParams }: { searchParams?: Promise<{ client?: string; section?: string }> }) {
  const { client, user } = await authenticatedServerClient();
  if (!user) return <><main className="shell"><section className="card"><h1>Coach sign-in required</h1><p>Sign in with an authorised Coach account to continue.</p></section></main><AppNav /></>;
  const [{ data, error }, { data: pending, error: pendingError }, { data: contexts, error: contextError }, clubContexts] = await Promise.all([
    client.rpc("coach_list_clients"),
    client.rpc("coach_list_pending_relationships"),
    client.rpc("coach_list_member_search_contexts"),
    listClubOrganisationContexts(client, user.id),
  ]);
  if (error || pendingError || contextError) {
    const firstError = error ?? pendingError ?? contextError;
    if (!firstError) throw new Error("Coach workspace failed without an error");
    console.error("[coach] workspace load failed", { code: firstError.code });
    const denied = firstError.code === "42501";
    return <><main className="shell"><section className="card"><h1>{denied ? "Coach access unavailable" : "Coach service unavailable"}</h1><p>{denied ? "Your account is not authorised for Coach yet." : "Coach is temporarily unavailable. Please try again shortly."}</p></section></main><AppNav /></>;
  }
  const diaryContext = clubContexts.find(context => context.role === "trainer") ?? clubContexts.find(context => ["gym_staff", "gym_admin", "owner"].includes(context.role));
  let scheduleSummary: { organisationId: string; organisationName: string; asOf: string; events: ScheduleEvent[] } | undefined;
  if (diaryContext) {
    const today = londonDateKey(new Date());
    const from = new Date(`${today}T00:00:00Z`).toISOString();
    const to = new Date(Date.parse(from) + 35 * 86400000).toISOString();
    const result = await client.rpc("club_list_shared_schedule", { p_organisation_id: diaryContext.organisation.id, p_from: from, p_to: to, p_staff_user_id: user.id, p_location_id: null });
    if (!result.error && Array.isArray(result.data)) scheduleSummary = { organisationId: diaryContext.organisation.id, organisationName: diaryContext.organisation.name, asOf: new Date().toISOString(), events: result.data as ScheduleEvent[] };
  }
  const params = searchParams ? await searchParams : {};
  const requestedSection = ["overview", "programme", "checkins", "progress", "history"].includes(params.section ?? "") ? params.section as CoachWorkspaceSection : undefined;
  return <><CoachWorkspace initialClients={(Array.isArray(data) ? data : []) as never} initialPending={(Array.isArray(pending) ? pending : []) as never} memberContexts={(Array.isArray(contexts) ? contexts : []) as never} initialClientId={params.client} initialSection={requestedSection} scheduleSummary={scheduleSummary} /><TutorialExperience area="coach" /><AppNav /></>;
}
