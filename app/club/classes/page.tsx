import { redirect } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { ClubClassesWorkspace } from "@/components/club-classes";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { resolveOrganisationTheme } from "@/lib/club";
import type { ClubRole, OrganisationLocation, OrganisationMember } from "@/lib/club";
import type { ClubClassAvailability, ClubClassBooking, ClubClassSession, ClubClassType } from "@/lib/club-operations";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubMemberClasses } from "@/components/club-member-classes";
const londonDay = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);

function AccessRequired() {
  return <AppShell className="module-page club-page club-classes-page"><PageHeader title="Classes" description="Timetable access is not available for this account." /><EmptyState title="Club access required">Ask an organisation owner to confirm your operational role.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
}

function LoadError() {
  return <AppShell className="module-page club-page club-classes-page"><PageHeader title="Classes" description="Timetable and class management." /><EmptyState title="Classes couldn’t be loaded.">Try again shortly. No class information has been changed.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
}

function LoadedClasses({ theme, organisation, classTypes, sessions, locations, members, availability, role, userId, today, contexts }: { theme: ReturnType<typeof resolveOrganisationTheme>; organisation: import("@/lib/club").Organisation; classTypes: ClubClassType[]; sessions: ClubClassSession[]; locations: OrganisationLocation[]; members: OrganisationMember[]; availability: Record<string, ClubClassAvailability | null>; role: ClubRole; userId: string; today: string; contexts?: Array<{ organisation: import("@/lib/club").Organisation; role: ClubRole }> }) {
  if (!(["gym_staff", "gym_admin", "owner", "trainer"] as ClubRole[]).includes(role)) return <MemberClassesLoaded organisation={organisation} classTypes={classTypes} locations={locations} sessions={sessions} availability={availability} bookings={[]} contexts={contexts} />;
  return <AppShell className="module-page club-page club-classes-page"><PageHeader title="Classes" description="Classes, capacity and timetable management." /><ClubSectionNav organisation={organisation} role={role} contexts={contexts} />{["gym_staff", "gym_admin", "owner"].includes(role) ? <Link className="text-button" href={`/club/classes/reports?org=${encodeURIComponent(organisation.id)}`}>Cancellation and credit reports</Link> : null}{["gym_admin", "owner"].includes(role) ? <Link className="text-button" href={`/club/classes/setup?org=${encodeURIComponent(organisation.id)}`}>Class, rota and daily-check setup</Link> : null}<ClubClassesWorkspace classTypes={classTypes} sessions={sessions} locations={locations} members={members} availability={availability} role={role} currentUserId={userId} today={today} accent={theme.primaryAccent} organisationId={organisation.id} /><BackButton href={`/club?org=${encodeURIComponent(organisation.id)}`}>Back to Club</BackButton><AppNav /></AppShell>;
}

type ClassCreditInfo = { credits: Array<{ id: string; issuedAt: string; expiresAt: string; status: "available" | "used" | "expired"; issuer: "member_cancellation" | "madhouse_cancellation" }>; history?: Array<{ eventType: string; bookingId: string | null; sourceBookingId: string; occurredAt: string }>; weeklyEntitlements: Array<{ sessionId: string; classWeek: string; status: "available" | "used" | "not_included" }> };
function MemberClassesLoaded({ organisation, classTypes, locations, sessions, availability, bookings, customerId, paygPriceMinor, classCredits, contexts }: { organisation: import("@/lib/club").Organisation; classTypes: ClubClassType[]; locations: OrganisationLocation[]; sessions: ClubClassSession[]; availability: Record<string, ClubClassAvailability | null>; bookings: ClubClassBooking[]; customerId?: string; paygPriceMinor?: number; classCredits?: ClassCreditInfo; contexts?: Array<{ organisation: import("@/lib/club").Organisation; role: ClubRole }> }) {
  return <AppShell className="module-page club-page club-classes-page"><PageHeader eyebrow="MY CLUB" title="Classes" description="View upcoming classes and manage your bookings." /><ClubSectionNav organisation={organisation} role="member" contexts={contexts} /><ClubMemberClasses sessions={sessions} availability={availability} bookings={bookings} customerId={customerId} paygPriceMinor={paygPriceMinor} classCredits={classCredits} locations={locations} classTypes={classTypes} /><BackButton href={`/club?org=${encodeURIComponent(organisation.id)}`}>Back to My Club</BackButton><AppNav /></AppShell>;
}

async function loadClasses(supabase: Awaited<ReturnType<typeof serverSupabase>>, userId: string, organisationId?: string) {
  const context = await resolveClubOrganisationContext(supabase, userId, organisationId);
  if (!context) return null;
  const [classTypes, locations, sessions] = await Promise.all([context.repository.listClassTypes(context.organisation.id), context.repository.listLocations(context.organisation.id), context.repository.listClassSessions(context.organisation.id)]);
  const today = londonDay(); const memberView = context.role === "member" || context.role === "guest"; const visibleSessions = sessions.filter(session => memberView ? session.status === "scheduled" && new Date(session.startsAt).getTime() >= Date.now() : true).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const availabilitySessions = visibleSessions.filter(session => session.status === "scheduled" && Date.parse(session.endsAt) >= Date.now());
  const availabilityResults = await Promise.allSettled(availabilitySessions.map(session => context.repository.getClassAvailability(session.id)));
  const availability = Object.fromEntries(availabilitySessions.map((session, index) => [session.id, availabilityResults[index].status === "fulfilled" ? availabilityResults[index].value : null]));
  const profile = ["gym_staff", "gym_admin", "owner", "trainer"].includes(context.role) ? undefined : await context.repository.getMemberOperationalProfile(context.organisation.id, userId);
  const bookings = profile?.customer?.id ? (await context.repository.listClassBookings(context.organisation.id)).filter(item => item.customerId === profile.customer!.id) : [];
  const [pricingResult, creditResult] = await Promise.all([
    supabase.from("club_madhouse_class_commercial_config").select("payg_price_minor,currency").eq("organisation_id", context.organisation.id).maybeSingle(),
    profile?.customer?.id ? supabase.rpc("club_list_my_class_credits", { p_organisation_id: context.organisation.id }) : Promise.resolve({ data: null, error: null }),
  ]);
  const classPricing = pricingResult.data;
  const paygPriceMinor = classPricing?.currency === "GBP" && Number.isInteger(classPricing.payg_price_minor) ? Number(classPricing.payg_price_minor) : undefined;
  const classCredits = creditResult.data && !creditResult.error ? creditResult.data as ClassCreditInfo : undefined;
  return { context, classTypes, locations, visibleSessions, today, availability, theme: resolveOrganisationTheme(context.organisation), memberCustomerId: profile?.customer?.id, memberBookings: bookings, paygPriceMinor, classCredits };
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
  return loaded.context.role === "member" || loaded.context.role === "guest" ? <MemberClassesLoaded organisation={loaded.context.organisation} classTypes={loaded.classTypes} locations={loaded.locations} sessions={loaded.visibleSessions} availability={loaded.availability} bookings={loaded.memberBookings} customerId={loaded.memberCustomerId} paygPriceMinor={loaded.paygPriceMinor} classCredits={loaded.classCredits} contexts={loaded.context.availableContexts} /> : <LoadedClasses theme={loaded.theme} organisation={loaded.context.organisation} classTypes={loaded.classTypes} sessions={loaded.visibleSessions} locations={loaded.locations} members={loaded.context.members} availability={loaded.availability} role={loaded.context.role} userId={user.id} today={loaded.today} contexts={loaded.context.availableContexts} />;
}
