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
import { LoadRecovery } from "@/components/load-recovery";
import { classifyLoadFailure, safeLoadFailureFields, type LoadFailureKind } from "@/lib/club-load-state";

export default async function CoachPage({ searchParams }: { searchParams?: Promise<{ client?: string; section?: string }> }) {
  const { client, user, error: authError } = await authenticatedServerClient();
  if (!user && authError && classifyLoadFailure(authError) !== "unavailable") return <main className="shell"><LoadRecovery app="Coach" kind={classifyLoadFailure(authError)} signInHref="/account?app=coach&mode=signIn&next=%2Fcoach"/></main>;
  if (!user) redirect("/account?app=coach&mode=signIn&next=%2Fcoach");
  if (hasCoachReviewerEntitlement(user)) return <CoachReviewerDemo screen="clients"/>;
  const [clientsResult, pendingResult, memberContextsResult, clubContextsResult] = await Promise.all([
    client.rpc("coach_list_clients"),
    client.rpc("coach_list_pending_relationships"),
    client.rpc("coach_list_member_search_contexts"),
    listClubOrganisationContexts(client, user.id).then(contexts => ({ contexts })).catch(error => ({ error })),
  ]);
  const { data, error } = clientsResult;
  const { data: pending, error: pendingError } = pendingResult;
  const { data: contexts, error: contextError } = memberContextsResult;
  if (error || pendingError || contextError) {
    const firstError = error ?? pendingError ?? contextError;
    if (!firstError) throw new Error("Coach workspace failed without an error");
    const kind = classifyLoadFailure(firstError);
    console.error("[coach] workspace load failed", safeLoadFailureFields(firstError));
    if (kind === "permission") return <main className="shell"><section className="card"><h1>Coach access not enabled</h1><p>This R12 account does not currently have Coach access. Contact the administrator who enabled your Coach account if you believe this is a mistake.</p><Link className="secondary" href="/" data-r12-coach-open-r12>Open R12</Link></section></main>;
    return <main className="shell"><LoadRecovery app="Coach" kind={kind} signInHref={kind === "session" ? "/account?app=coach&mode=signIn&next=%2Fcoach" : undefined}/></main>;
  }
  let scheduleIssue: LoadFailureKind | undefined;
  if ("error" in clubContextsResult) {
    scheduleIssue = classifyLoadFailure(clubContextsResult.error);
    console.warn("[coach] optional Club schedule context unavailable", safeLoadFailureFields(clubContextsResult.error));
  }
  const clubContexts = "contexts" in clubContextsResult ? clubContextsResult.contexts : [];
  const diaryContext = clubContexts.find(context => context.role === "trainer") ?? clubContexts.find(context => ["gym_staff", "gym_admin", "owner"].includes(context.role));
  let scheduleSummary: { organisationId: string; organisationName: string; asOf: string; events: ScheduleEvent[] } | undefined;
  if (diaryContext) {
    const today = londonDateKey(new Date());
    const from = new Date(`${today}T00:00:00Z`).toISOString();
    const to = new Date(Date.parse(from) + 35 * 86400000).toISOString();
    const result = await client.rpc("club_list_shared_schedule", { p_organisation_id: diaryContext.organisation.id, p_from: from, p_to: to, p_staff_user_id: user.id, p_location_id: null });
    if (!result.error && Array.isArray(result.data)) scheduleSummary = { organisationId: diaryContext.organisation.id, organisationName: diaryContext.organisation.name, asOf: new Date().toISOString(), events: result.data as ScheduleEvent[] };
    else if (result.error) { scheduleIssue = classifyLoadFailure(result.error); console.warn("[coach] optional schedule preview unavailable", safeLoadFailureFields(result.error)); }
  }
  const params = searchParams ? await searchParams : {};
  const requestedSection = ["overview", "programme", "checkins", "progress", "history"].includes(params.section ?? "") ? params.section as CoachWorkspaceSection : undefined;
  return <>{scheduleIssue ? <main className="shell"><LoadRecovery app="Coach schedule preview" kind={scheduleIssue}/></main> : null}<CoachWorkspace initialClients={(Array.isArray(data) ? data : []) as never} initialPending={(Array.isArray(pending) ? pending : []) as never} memberContexts={(Array.isArray(contexts) ? contexts : []) as never} initialClientId={params.client} initialSection={requestedSection} scheduleSummary={scheduleSummary}/><TutorialExperience area="coach" /></>;
}
