import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubClassesWorkspace } from "@/components/club-classes";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { resolveOrganisationTheme } from "@/lib/club";
import type { ClubRole, OrganisationLocation, OrganisationMember } from "@/lib/club";
import type { ClubClassAvailability, ClubClassSession, ClubClassType } from "@/lib/club-operations";
import { ClubSectionNav } from "@/components/club-shell";
const londonDay = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);

function AccessRequired() {
  return <AppShell className="module-page club-classes-page"><PageHeader eyebrow="R12 CLUB" title="Classes" description="Timetable access is not available for this account." /><EmptyState title="Club access required">Ask an organisation owner to confirm your operational role.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
}

function LoadError() {
  return <AppShell className="module-page club-classes-page"><PageHeader eyebrow="R12 CLUB" title="Classes" description="Timetable and class management." /><EmptyState title="Classes couldn’t be loaded.">Try again shortly. No class information has been changed.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
}

function LoadedClasses({ theme, organisation, classTypes, sessions, locations, members, availability, role, userId, today, contexts }: { theme: ReturnType<typeof resolveOrganisationTheme>; organisation: import("@/lib/club").Organisation; classTypes: ClubClassType[]; sessions: ClubClassSession[]; locations: OrganisationLocation[]; members: OrganisationMember[]; availability: Record<string, ClubClassAvailability | null>; role: ClubRole; userId: string; today: string; contexts?: Array<{ organisation: import("@/lib/club").Organisation; role: ClubRole }> }) {
  return <AppShell className="module-page club-classes-page"><PageHeader eyebrow="R12 CLUB · CLASSES" title="Classes" description="Classes, capacity and timetable management." /><ClubSectionNav organisation={organisation} role={role} contexts={contexts} /><ClubClassesWorkspace classTypes={classTypes} sessions={sessions} locations={locations} members={members} availability={availability} role={role} currentUserId={userId} today={today} accent={theme.primaryAccent} /><BackButton href={`/club?org=${encodeURIComponent(organisation.id)}`}>Back to Club</BackButton><AppNav /></AppShell>;
}

async function loadClasses(supabase: Awaited<ReturnType<typeof serverSupabase>>, userId: string, organisationId?: string) {
  const context = await resolveClubOperationalContext(supabase, userId, organisationId);
  if (!context) return null;
  const [classTypes, locations, sessions] = await Promise.all([context.repository.listClassTypes(context.organisation.id), context.repository.listLocations(context.organisation.id), context.repository.listClassSessions(context.organisation.id)]);
  const today = londonDay(); const visibleSessions = sessions.filter(session => londonDay(new Date(session.startsAt)) >= today).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const availabilityResults = await Promise.allSettled(visibleSessions.map(session => context.repository.getClassAvailability(session.id)));
  const availability = Object.fromEntries(visibleSessions.map((session, index) => [session.id, availabilityResults[index].status === "fulfilled" ? availabilityResults[index].value : null]));
  return { context, classTypes, locations, visibleSessions, today, availability, theme: resolveOrganisationTheme(context.organisation) };
}

export default async function ClubClassesPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  let loaded: Awaited<ReturnType<typeof loadClasses>> | undefined;
  let failed = false;
  try {
    loaded = await loadClasses(supabase, user.id, (await searchParams)?.org);
  } catch (error) {
    console.error("[club-classes] timetable load failed", { operation: error instanceof Error && "operation" in error ? error.operation : "load_classes" });
    failed = true;
  }
  if (failed || !loaded) return failed ? <LoadError /> : <AccessRequired />;
  return <LoadedClasses theme={loaded.theme} organisation={loaded.context.organisation} classTypes={loaded.classTypes} sessions={loaded.visibleSessions} locations={loaded.locations} members={loaded.context.members} availability={loaded.availability} role={loaded.context.role} userId={user.id} today={loaded.today} contexts={loaded.context.availableContexts} />;
}
