import { redirect } from "next/navigation";
import Link from "next/link";
import { ClubScheduleCalendar } from "@/components/club-schedule-calendar";
import { AppShell, EmptyState } from "@/components/ui";
import styles from "@/components/coach-diary.module.css";
import { listClubOrganisationContexts } from "@/lib/club-server-context";
import { londonDateKey, type ScheduleEvent, type WeeklyWorkingHours } from "@/lib/club-scheduling";
import { getServerUser } from "@/lib/supabase-server";
import { CoachReviewerDemo } from "@/components/coach-reviewer-demo";
import { hasCoachReviewerEntitlement } from "@/lib/play-reviewer";
import { LoadRecovery } from "@/components/load-recovery";
import { classifyLoadFailure, safeLoadFailureFields } from "@/lib/club-load-state";

export default async function CoachDiaryPage({ searchParams }: { searchParams?: Promise<{ org?: string; date?: string }> }) {
  const { client: supabase, user, error: authError } = await getServerUser();
  if (!user && authError && classifyLoadFailure(authError) !== "unavailable") return <AppShell className={`module-page ${styles.page}`}><h1 className="coach-visually-hidden">Diary</h1><LoadRecovery app="Coach Diary" kind={classifyLoadFailure(authError)} signInHref="/account?app=coach&mode=signIn&next=%2Fcoach%2Fdiary"/></AppShell>;
  if (!user) redirect("/account?app=coach&mode=signIn&next=%2Fcoach%2Fdiary");
  if (hasCoachReviewerEntitlement(user)) return <CoachReviewerDemo screen="diary"/>;
  const { data: coachAccess, error: coachAccessError } = await supabase.rpc("coach_has_access", { p_client_user_id: null });
  if (coachAccessError) { console.error("[coach-diary] access check failed", safeLoadFailureFields(coachAccessError)); return <AppShell className={`module-page ${styles.page}`}><h1 className="coach-visually-hidden">Diary</h1><LoadRecovery app="Coach Diary" kind={classifyLoadFailure(coachAccessError)}/></AppShell>; }
  if (!coachAccess) redirect("/coach");
  const params = await searchParams;
  let contexts;
  try { contexts = await listClubOrganisationContexts(supabase, user.id); }
  catch (error) { console.error("[coach-diary] organisation context failed", safeLoadFailureFields(error)); return <AppShell className={`module-page ${styles.page}`}><h1 className="coach-visually-hidden">Diary</h1><LoadRecovery app="Coach Diary" kind={classifyLoadFailure(error)}/></AppShell>; }
  const eligible = contexts.filter(context => ["trainer", "gym_staff", "gym_admin", "owner"].includes(context.role));
  if (!eligible.length) return <AppShell className={`module-page ${styles.page}`}><h1 className="coach-visually-hidden">Diary</h1><EmptyState title="No Club diary is linked yet">Your Coach access is active, but there isn’t an active Club staff diary for this account. Ask authorised management to connect your staff role.</EmptyState></AppShell>;
  const context = params?.org ? eligible.find(item => item.organisation.id === params.org) : eligible.length === 1 ? eligible[0] : undefined;
  if (!context || !["trainer", "gym_staff", "gym_admin", "owner"].includes(context.role)) return <AppShell className={`module-page ${styles.page}`}><h1 className="coach-visually-hidden">Diary</h1>{eligible.length > 1 ? <section className={styles.orgPicker}><h2>Choose your Club diary</h2><p>Select the location group you want to view.</p>{eligible.map(item => <Link className={styles.orgLink} key={item.organisation.id} href={`/coach/diary?org=${encodeURIComponent(item.organisation.id)}`}>{item.organisation.name}<span>Open diary →</span></Link>)}</section> : <EmptyState title="Diary access unavailable">Your Coach account does not have an active staff role for this schedule.</EmptyState>}</AppShell>;

  const date = params?.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : londonDateKey(new Date());
  const anchor = new Date(`${date}T12:00:00Z`);
  const from = new Date(anchor.getTime() - 28 * 86400000).toISOString();
  const to = new Date(anchor.getTime() + 28 * 86400000).toISOString();
  let eventsResult: Awaited<ReturnType<typeof supabase.rpc>>;
  let hoursResult: Awaited<ReturnType<typeof supabase.rpc>>;
  let locations: Awaited<ReturnType<typeof context.repository.listLocations>>;
  try {
  [eventsResult, hoursResult, locations] = await Promise.all([
    supabase.rpc("club_list_shared_schedule", { p_organisation_id: context.organisation.id, p_from: from, p_to: to, p_staff_user_id: user.id, p_location_id: null }),
    supabase.rpc("club_list_shared_working_hours", { p_organisation_id: context.organisation.id }),
    context.repository.listLocations(context.organisation.id),
  ]);
  } catch (error) {
    console.error("[coach-diary] diary data load failed", safeLoadFailureFields(error));
    return <AppShell className={`module-page ${styles.page}`}><h1 className="coach-visually-hidden">Diary</h1><LoadRecovery app="Coach Diary" kind={classifyLoadFailure(error)}/></AppShell>;
  }
  const unavailable = eventsResult.error || hoursResult.error;
  const events = !eventsResult.error && Array.isArray(eventsResult.data) ? eventsResult.data as ScheduleEvent[] : [];
  const allHours = !hoursResult.error && Array.isArray(hoursResult.data) ? hoursResult.data as WeeklyWorkingHours[] : [];
  const workingHours = allHours.filter(item => item.staffUserId === user.id);
  const userName = [user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(" ") || user.user_metadata?.display_name || "My diary";
  return <AppShell className={`module-page ${styles.page}`}><h1 className="coach-visually-hidden">Diary</h1>
    {eligible.length > 1 ? <div className={styles.contextSwitch} aria-label="Choose organisation">{eligible.map(item => <Link className={item.organisation.id === context.organisation.id ? styles.selected : ""} aria-current={item.organisation.id === context.organisation.id ? "page" : undefined} key={item.organisation.id} href={`/coach/diary?org=${encodeURIComponent(item.organisation.id)}&date=${encodeURIComponent(date)}`}>{item.organisation.name}</Link>)}</div> : null}
    {unavailable ? <LoadRecovery app="Coach Diary" kind={classifyLoadFailure(eventsResult.error ?? hoursResult.error)}/> : <ClubScheduleCalendar key={`${context.organisation.id}-${date}`} organisationId={context.organisation.id} events={events} staff={[{ userId: user.id, name: userName }]} rotaStaff={[]} locations={locations} initialDate={date} workingHours={workingHours} currentUserId={user.id} canManageTeamHours={false} canManageRota={false} coachMode/>}
    </AppShell>;
}
