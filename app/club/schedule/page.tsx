import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubScheduleCalendar } from "@/components/club-schedule-calendar";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { londonDateKey, type ScheduleEvent, type WeeklyWorkingHours } from "@/lib/club-scheduling";

export default async function ClubSchedulePage({ searchParams }: { searchParams?: Promise<{ org?: string; date?: string }> }) {
  const supabase=await serverSupabase();const {data:{user}}=await supabase.auth.getUser();if(!user)redirect("/account?mode=signIn");
  const params=await searchParams;const context=await resolveClubOrganisationContext(supabase,user.id,params?.org);
  if(!context||!["trainer","gym_staff","gym_admin","owner"].includes(context.role))return <AppShell className="module-page"><PageHeader eyebrow="R12 CLUB" title="Schedule"/><EmptyState title="Schedule access required">Choose an organisation where you have an active Club role.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav/></AppShell>;
  const requestedDate=params?.date&&/^\d{4}-\d{2}-\d{2}$/.test(params.date)?params.date:londonDateKey(new Date());const anchor=new Date(`${requestedDate}T12:00:00Z`);const from=new Date(anchor.getTime()-28*86400000).toISOString();const to=new Date(anchor.getTime()+28*86400000).toISOString();
  const [eventsResult,staffResult,hoursResult,locations]=await Promise.all([supabase.rpc("club_list_shared_schedule",{p_organisation_id:context.organisation.id,p_from:from,p_to:to,p_staff_user_id:null,p_location_id:null}),supabase.rpc("club_list_schedule_staff",{p_organisation_id:context.organisation.id}),supabase.rpc("club_list_shared_working_hours",{p_organisation_id:context.organisation.id}),context.repository.listLocations(context.organisation.id)]);
  if(eventsResult.error||staffResult.error||hoursResult.error)return <AppShell className="module-page"><PageHeader eyebrow="R12 CLUB" title="Schedule"/><EmptyState title="Schedule couldn’t be loaded">Try again shortly. No schedule information was changed.</EmptyState><BackButton href={`/club?org=${encodeURIComponent(context.organisation.id)}`}>Back to Club</BackButton><AppNav/></AppShell>;
  const events=(Array.isArray(eventsResult.data)?eventsResult.data:[]) as ScheduleEvent[];const allStaff=Array.isArray(staffResult.data)?staffResult.data as Array<{userId:string;name:string}>:[];const staff=context.role==="trainer"?allStaff.filter(person=>person.userId===user.id):allStaff;
  const workingHours=Array.isArray(hoursResult.data)?hoursResult.data as WeeklyWorkingHours[]:[];
  const canManageRota=context.role==="owner"||context.role==="gym_admin";
  const rotaStaffResult=canManageRota?await supabase.rpc("club_list_rota_staff",{p_organisation_id:context.organisation.id}):undefined;
  const rotaStaff=Array.isArray(rotaStaffResult?.data)?rotaStaffResult.data as Array<{userId:string;name:string}>:[];
  return <AppShell className="module-page"><PageHeader eyebrow="R12 CLUB · OPERATIONS" title="Schedule" description="PT diary, classes and Madhouse staffing rota in one view."/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><ClubScheduleCalendar key={`${context.organisation.id}-${requestedDate}`} organisationId={context.organisation.id} events={events} staff={staff} rotaStaff={rotaStaff} locations={locations} initialDate={requestedDate} workingHours={workingHours} currentUserId={user.id} canManageTeamHours={context.role==="owner"||context.role==="gym_admin"} canManageRota={canManageRota}/><BackButton href={`/club?org=${encodeURIComponent(context.organisation.id)}`}>Back to Club</BackButton><AppNav/></AppShell>;
}
