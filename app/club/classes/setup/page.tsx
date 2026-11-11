import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubClassSetup } from "@/components/club-class-setup";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubClassesWorkspace } from "@/components/club-classes";
import { resolveOrganisationTheme } from "@/lib/club";

export default async function MadhouseClassSetupPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOrganisationContext(supabase, user.id, (await searchParams)?.org);
  if (!context || !["gym_admin", "owner"].includes(context.role)) {
    return <AppShell className="module-page club-page club-classes-page"><PageHeader eyebrow="R12 CLUB · CLASSES" title="Operational setup" description="This setup is restricted to Club management."/><EmptyState title="Management access required">Ask an organisation owner to confirm your operational role.</EmptyState><BackButton href="/club/classes">Back to classes</BackButton><AppNav /></AppShell>;
  }
  const [classTypes, locations] = await Promise.all([context.repository.listClassTypes(context.organisation.id), context.repository.listLocations(context.organisation.id)]);
  const [templates, assignments, items] = await Promise.all([
    supabase.from("club_checklist_templates").select("id", { count: "exact", head: true }).eq("organisation_id", context.organisation.id).eq("active", true),
    supabase.from("club_checklist_template_locations").select("id", { count: "exact", head: true }).eq("organisation_id", context.organisation.id),
    supabase.from("club_checklist_items").select("id", { count: "exact", head: true }).eq("organisation_id", context.organisation.id).eq("active", true),
  ]);
  const checklistState = templates.error || assignments.error || items.error ? null : { templateCount: templates.count ?? 0, locationCount: assignments.count ?? 0, activeItemCount: items.count ?? 0 };
  return <AppShell className="module-page club-page club-classes-page"><PageHeader title="Class, rota & daily-check setup"/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><ClubClassesWorkspace classTypes={classTypes} sessions={[]} locations={locations} members={context.members} availability={{}} role={context.role} currentUserId={user.id} today={new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())} accent={resolveOrganisationTheme(context.organisation).primaryAccent} organisationId={context.organisation.id} showTimetable={false}/><ClubClassSetup organisationId={context.organisation.id} checklistState={checklistState}/><BackButton href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}>Back to classes</BackButton><AppNav /></AppShell>;
}
