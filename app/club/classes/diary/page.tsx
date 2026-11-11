import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubScheduleCalendar } from "@/components/club-schedule-calendar";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { londonDateKey, type ScheduleEvent, type WeeklyWorkingHours } from "@/lib/club-scheduling";
import { serverSupabase } from "@/lib/supabase-server";

export default async function ClubPtDiaryPage({ searchParams }: { searchParams?: Promise<{ org?: string; date?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn&next=%2Fclub%2Fclasses%2Fdiary");
  const params = await searchParams;
  const context = await resolveClubOperationalContext(supabase, user.id, params?.org);
  const allowedRole = context && ["trainer", "gym_staff", "gym_admin", "owner"].includes(context.role);
  if (!context || !allowedRole) return <AppShell className="module-page club-page"><PageHeader title="PT diary" /><EmptyState title="Diary access unavailable">Your account does not have an active staff role for this organisation.</EmptyState><BackButton href="/club/classes">Back to Classes &amp; PT</BackButton><AppNav /></AppShell>;
  const { data: coachAccess, error: coachError } = await supabase.rpc("coach_has_access", { p_client_user_id: null });
  if (coachError || coachAccess !== true) return <AppShell className="module-page club-page"><PageHeader title="PT diary" /><EmptyState title="Coach access required">Ask an authorised manager to confirm your existing Coach access.</EmptyState><BackButton href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}>Back to Classes &amp; PT</BackButton><AppNav /></AppShell>;

  const requestedDate = params?.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : londonDateKey(new Date());
  const anchor = new Date(`${requestedDate}T12:00:00Z`);
  const from = new Date(anchor.getTime() - 28 * 86400000).toISOString();
  const to = new Date(anchor.getTime() + 28 * 86400000).toISOString();
  const [eventsResult, hoursResult, locations] = await Promise.all([
    supabase.rpc("club_list_shared_schedule", { p_organisation_id: context.organisation.id, p_from: from, p_to: to, p_staff_user_id: user.id, p_location_id: null }),
    supabase.rpc("club_list_shared_working_hours", { p_organisation_id: context.organisation.id }),
    context.repository.listLocations(context.organisation.id),
  ]);
  if (eventsResult.error || hoursResult.error) return <AppShell className="module-page club-page"><PageHeader title="PT diary" /><EmptyState title="The diary couldn’t be loaded">Try again shortly. No schedule information was changed.</EmptyState><BackButton href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}>Back to Classes &amp; PT</BackButton><AppNav /></AppShell>;
  const events = Array.isArray(eventsResult.data) ? eventsResult.data as ScheduleEvent[] : [];
  const allHours = Array.isArray(hoursResult.data) ? hoursResult.data as WeeklyWorkingHours[] : [];
  const workingHours = allHours.filter(item => item.staffUserId === user.id);
  const profileName = (await context.repository.listMemberIdentities(context.organisation.id)).find(member => member.userId === user.id)?.displayName;
  const userName = profileName || [user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(" ") || "My diary";
  return <AppShell className="module-page club-page club-classes-page"><PageHeader title="PT diary" /><ClubScheduleCalendar key={`${context.organisation.id}-${requestedDate}`} organisationId={context.organisation.id} events={events} staff={[{ userId: user.id, name: userName }]} rotaStaff={[]} locations={locations} initialDate={requestedDate} workingHours={workingHours} currentUserId={user.id} canManageTeamHours={false} canManageRota={false} coachMode clubMode /><BackButton href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}>Back to Classes &amp; PT</BackButton><AppNav /></AppShell>;
}
