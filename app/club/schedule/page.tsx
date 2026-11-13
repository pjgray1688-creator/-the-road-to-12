import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubScheduleCalendar } from "@/components/club-schedule-calendar";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { londonDateKey, type ScheduleEvent, type WeeklyWorkingHours } from "@/lib/club-scheduling";
import { filterRotaStaff, resolveRotaScope } from "@/lib/club-rota-scope";

type ScheduleParams = { org?: string; date?: string; view?: string };
type StaffChoice = { userId: string; name: string };

export default async function ClubSchedulePage({ searchParams }: { searchParams?: Promise<ScheduleParams> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");

  const params = await searchParams;
  const context = await resolveClubOrganisationContext(supabase, user.id, params?.org);
  if (!context || !["trainer", "gym_staff", "gym_admin", "owner"].includes(context.role)) {
    return <AppShell className="module-page"><PageHeader title="My Rota"/><EmptyState title="Rota access required">Choose an organisation where you have an active staff role.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav/></AppShell>;
  }

  const canManageRota = context.role === "owner" || context.role === "gym_admin";
  const scope = resolveRotaScope(context.role, params?.view);
  const requestedDate = params?.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : londonDateKey(new Date());
  const anchor = new Date(`${requestedDate}T12:00:00Z`);
  const from = new Date(anchor.getTime() - 28 * 86400000).toISOString();
  const to = new Date(anchor.getTime() + 28 * 86400000).toISOString();

  const [eventsResult, staffResult, hoursResult, locations] = await Promise.all([
    supabase.rpc("club_list_shared_schedule", {
      p_organisation_id: context.organisation.id,
      p_from: from,
      p_to: to,
      p_staff_user_id: scope === "team" ? null : user.id,
      p_location_id: null,
    }),
    supabase.rpc("club_list_schedule_staff", { p_organisation_id: context.organisation.id }),
    canManageRota ? supabase.rpc("club_list_shared_working_hours", { p_organisation_id: context.organisation.id }) : Promise.resolve({ data: [], error: null }),
    context.repository.listLocations(context.organisation.id),
  ]);

  if (eventsResult.error || staffResult.error || hoursResult.error) {
    return <AppShell className="module-page"><PageHeader title="My Rota"/><EmptyState title="Rota couldn’t be loaded">Try again shortly. No schedule information was changed.</EmptyState><BackButton href={`/club?org=${encodeURIComponent(context.organisation.id)}`}>Back to Club</BackButton><AppNav/></AppShell>;
  }

  const events = (Array.isArray(eventsResult.data) ? eventsResult.data : []) as ScheduleEvent[];
  const rotaEvents = events.filter(event => ["rota_shift", "leave_request", "leave"].includes(event.eventType));
  const allStaff = (Array.isArray(staffResult.data) ? staffResult.data : []) as StaffChoice[];
  const staff = filterRotaStaff(allStaff, scope, user.id);
  const workingHours = (Array.isArray(hoursResult.data) ? hoursResult.data : []) as WeeklyWorkingHours[];
  const rotaStaffResult = canManageRota ? await supabase.rpc("club_list_rota_staff", { p_organisation_id: context.organisation.id }) : undefined;
  const rotaStaff = Array.isArray(rotaStaffResult?.data) ? rotaStaffResult.data as StaffChoice[] : [];
  const org = encodeURIComponent(context.organisation.id);
  const date = encodeURIComponent(requestedDate);
  const scopeHref = (next: "mine" | "team") => `/club/schedule?org=${org}&view=${next}&date=${date}`;

  return <AppShell className="module-page club-page club-rota-page">
    <PageHeader title={scope === "team" ? "Staff Rota" : "My Rota"}/>
    {canManageRota ? <nav className="club-rota-scope" aria-label="Rota view">
      <Link href={scopeHref("mine")} aria-current={scope === "mine" ? "page" : undefined}>My rota</Link>
      <Link href={scopeHref("team")} aria-current={scope === "team" ? "page" : undefined}>Team rota</Link>
    </nav> : null}
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/>
    <ClubScheduleCalendar key={`${context.organisation.id}-${requestedDate}-${scope}`} organisationId={context.organisation.id} events={rotaEvents} staff={staff} rotaStaff={rotaStaff} locations={locations} initialDate={requestedDate} workingHours={workingHours} currentUserId={user.id} canManageTeamHours={canManageRota} canManageRota={canManageRota} rotaMode/>
    <BackButton href={`/club?org=${org}`}>Back to Overview</BackButton><AppNav/>
  </AppShell>;
}
