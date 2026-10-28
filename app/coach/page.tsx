import { CoachWorkspace } from "@/components/coach-workspace";
import Link from "next/link";
import { authenticatedServerClient } from "@/lib/require-user";
import { TutorialExperience } from "@/components/tutorial-experience";
import type { CoachWorkspaceSection } from "@/components/coach-client-workspace";
import { listClubOrganisationContexts } from "@/lib/club-server-context";
import { londonDateKey, type ScheduleEvent } from "@/lib/club-scheduling";
import { CoachReviewerDemo } from "@/components/coach-reviewer-demo";
import { hasCoachReviewerEntitlement } from "@/lib/play-reviewer";
import { redirect } from "next/navigation";

export default async function CoachPage({ searchParams }: { searchParams?: Promise<{ client?: string; section?: string }> }) {
  const { client, user } = await authenticatedServerClient();
  if (!user) redirect("/account?app=coach&mode=signIn&next=%2Fcoach");
  if (hasCoachReviewerEntitlement(user)) return <CoachReviewerDemo screen="clients"/>;
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
    return <main className="shell"><section className="card"><h1>{denied ? "Coach access not enabled" : "Coach service unavailable"}</h1><p>{denied ? "This R12 account does not currently have Coach access. Contact the administrator who enabled your Coach account if you believe this is a mistake." : "Coach is temporarily unavailable. Please try again shortly."}</p>{denied ? <Link className="secondary" href="/" data-r12-coach-open-r12>Open R12</Link> : null}</section></main>;
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
  return <><CoachWorkspace initialClients={(Array.isArray(data) ? data : []) as never} initialPending={(Array.isArray(pending) ? pending : []) as never} memberContexts={(Array.isArray(contexts) ? contexts : []) as never} initialClientId={params.client} initialSection={requestedSection} scheduleSummary={scheduleSummary} /><TutorialExperience area="coach" /></>;
}
