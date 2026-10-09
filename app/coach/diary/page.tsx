import { redirect } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { CoachNavigation } from "@/components/coach-navigation";
import { ClubScheduleCalendar } from "@/components/club-schedule-calendar";
import { AppShell, EmptyState, PageHeader } from "@/components/ui";
import styles from "@/components/coach-diary.module.css";
import { resolveClubOrganisationContext, listClubOrganisationContexts } from "@/lib/club-server-context";
import { londonDateKey, type ScheduleEvent, type WeeklyWorkingHours } from "@/lib/club-scheduling";
import { serverSupabase } from "@/lib/supabase-server";

export default async function CoachDiaryPage({ searchParams }: { searchParams?: Promise<{ org?: string; date?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fcoach%2Fdiary");
  const { data: coachAccess, error: coachAccessError } = await supabase.rpc("coach_has_access", { p_client_user_id: null });
  if (coachAccessError || !coachAccess) redirect("/coach");
  const params = await searchParams;
  const contexts = await listClubOrganisationContexts(supabase, user.id);
  const eligible = contexts.filter(context => ["trainer", "gym_staff", "gym_admin", "owner"].includes(context.role));
  if (!eligible.length) return <AppShell className={`module-page ${styles.page}`}><CoachNavigation active="diary"/><PageHeader eyebrow="R12 COACH" title="Your diary"/><EmptyState title="No Madhouse diary is linked yet">Your Coach access is active, but there isn’t an active Madhouse staff diary for this account. Ask authorised management to connect your staff role.</EmptyState><AppNav/></AppShell>;
  const context = await resolveClubOrganisationContext(supabase, user.id, params?.org);
  if (!context || !["trainer", "gym_staff", "gym_admin", "owner"].includes(context.role)) return <AppShell className={`module-page ${styles.page}`}><CoachNavigation active="diary"/><PageHeader eyebrow="R12 COACH" title="Your diary"/>{eligible.length > 1 ? <section className={styles.orgPicker}><h2>Choose your Madhouse diary</h2><p>Select the location group you want to view.</p>{eligible.map(item => <Link className={styles.orgLink} key={item.organisation.id} href={`/coach/diary?org=${encodeURIComponent(item.organisation.id)}`}>{item.organisation.name}<span>Open diary →</span></Link>)}</section> : <EmptyState title="Diary access unavailable">Your Coach account does not have an active staff role for this schedule.</EmptyState>}<AppNav/></AppShell>;

  const date = params?.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : londonDateKey(new Date());
  const anchor = new Date(`${date}T12:00:00Z`);
  const from = new Date(anchor.getTime() - 28 * 86400000).toISOString();
  const to = new Date(anchor.getTime() + 28 * 86400000).toISOString();
  const [eventsResult, hoursResult, locations] = await Promise.all([
    supabase.rpc("club_list_shared_schedule", { p_organisation_id: context.organisation.id, p_from: from, p_to: to, p_staff_user_id: user.id, p_location_id: null }),
    supabase.rpc("club_list_shared_working_hours", { p_organisation_id: context.organisation.id }),
    context.repository.listLocations(context.organisation.id),
  ]);
  const unavailable = eventsResult.error || hoursResult.error;
  const events = !eventsResult.error && Array.isArray(eventsResult.data) ? eventsResult.data as ScheduleEvent[] : [];
  const allHours = !hoursResult.error && Array.isArray(hoursResult.data) ? hoursResult.data as WeeklyWorkingHours[] : [];
  const workingHours = allHours.filter(item => item.staffUserId === user.id);
  const userName = [user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(" ") || user.user_metadata?.display_name || "My diary";
  return <AppShell className={`module-page ${styles.page}`}><CoachNavigation active="diary" organisationId={context.organisation.id}/><PageHeader eyebrow={`${context.organisation.name.toUpperCase()} · R12 COACH`} title="My diary" description="Your sessions, classes, diary blocks and Madhouse rota — all in UK local time."/>
    {eligible.length > 1 ? <div className={styles.contextSwitch} aria-label="Choose organisation">{eligible.map(item => <Link className={item.organisation.id === context.organisation.id ? styles.selected : ""} aria-current={item.organisation.id === context.organisation.id ? "page" : undefined} key={item.organisation.id} href={`/coach/diary?org=${encodeURIComponent(item.organisation.id)}&date=${encodeURIComponent(date)}`}>{item.organisation.name}</Link>)}</div> : null}
    {unavailable ? <EmptyState title="Your diary couldn’t be loaded">Try again shortly. No schedule information was changed.</EmptyState> : <ClubScheduleCalendar key={`${context.organisation.id}-${date}`} organisationId={context.organisation.id} events={events} staff={[{ userId: user.id, name: userName }]} rotaStaff={[]} locations={locations} initialDate={date} workingHours={workingHours} currentUserId={user.id} canManageTeamHours={false} canManageRota={false} coachMode/>}
    <AppNav/></AppShell>;
}
