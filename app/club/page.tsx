/* eslint-disable react-hooks/error-boundaries, react-hooks/purity */
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { ClubSectionNav } from "@/components/club-shell";
import styles from "@/components/club-operations.module.css";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { getServerUser } from "@/lib/supabase-server";
import { listClubOrganisationContexts, isClubStaffRole, toClubNavContexts } from "@/lib/club-server-context";
import { resolveOrganisationTheme } from "@/lib/club";
import type { Metadata } from "next";
import { clubMetadata } from "@/lib/club-metadata";
import { hasPlayReviewerEntitlement } from "@/lib/play-reviewer";
import { ClubMemberHome } from "@/components/club-member-home";
import { LoadRecovery } from "@/components/load-recovery";
import { classifyLoadFailure, safeLoadFailureFields } from "@/lib/club-load-state";
import overviewStyles from "@/components/club-desktop-overview.module.css";
import type { ClubClassBooking, ClubClassSession, ClubServiceTransaction } from "@/lib/club-operations";
import { listLinkedInstructorIdentities, resolveInstructorName } from "@/lib/club-instructor-name";
import { displayClassTitle } from "@/lib/club-class-presentation";
import { MADHOUSE_PRODUCTION_ORGANISATION_ID } from "@/lib/madhouse-catalogue";

const roleLabel = (role: string) => role.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());

export async function generateMetadata({ searchParams }: { searchParams?: Promise<{ org?: string; location?: string }> }): Promise<Metadata> {
  try {
    const { client: supabase, user } = await getServerUser();
    if (!user) return clubMetadata("Overview");
    if (hasPlayReviewerEntitlement(user)) return clubMetadata("Google Play review · demo");
    const contexts = await listClubOrganisationContexts(supabase, user.id); const params = await searchParams; const orgId = params?.org; const organisation = contexts.find(item => item.organisation.id === orgId)?.organisation ?? (contexts.length === 1 ? contexts[0].organisation : undefined);
    return clubMetadata("Overview", organisation?.name);
  } catch { return clubMetadata("Overview"); }
}

export default async function ClubPage({ searchParams }: { searchParams?: Promise<{ org?: string; location?: string }> }) {
  const { client: supabase, user, error: authError } = await getServerUser();
  if (!user && authError && classifyLoadFailure(authError) !== "unavailable") {
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Club"/><LoadRecovery app="Club" kind={classifyLoadFailure(authError)} signInHref="/account?app=club&mode=signIn&next=%2Fclub"/></AppShell>;
  }
  if (!user) { const params = await searchParams; const next = `/club${params?.org ? `?org=${encodeURIComponent(params.org)}` : ""}`; redirect(`/account?app=club&mode=signIn&next=${encodeURIComponent(next)}`); }
  if (hasPlayReviewerEntitlement(user)) redirect("/club/reviewer");
  try {
    const contexts = await listClubOrganisationContexts(supabase, user.id);
    const params = await searchParams; const orgId = params?.org;
    const context = orgId ? contexts.find(item => item.organisation.id === orgId) : contexts.length === 1 ? contexts[0] : undefined;
    if (!context) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Choose your organisation" description="Select the gym workspace you want to use." />{contexts.length ? <Surface><div className={styles.quickGrid}>{contexts.map(item => <Link key={item.organisation.id} href={`/club?org=${encodeURIComponent(item.organisation.id)}`}><strong>{item.organisation.name}</strong><small>{roleLabel(item.role)} · Open workspace</small></Link>)}</div></Surface> : <EmptyState title="Club access required">Your account is not linked to an active Club organisation.</EmptyState>}</AppShell>;
    const theme = resolveOrganisationTheme(context.organisation);
    const role = context.role;
    const showMyAccess = context.organisation.id === MADHOUSE_PRODUCTION_ORGANISATION_ID;
    const navContexts = toClubNavContexts(contexts);
    if (!isClubStaffRole(role)) {
      try {
        const profile = await context.repository.getMemberOperationalProfile(context.organisation.id, user.id);
        const results = await Promise.allSettled([
          context.repository.getBalanceAccount(context.organisation.id, user.id),
          context.repository.listLocations(context.organisation.id),
          context.repository.listClassSessions(context.organisation.id),
          context.repository.listOrders(context.organisation.id),
          context.repository.listClassBookings(context.organisation.id),
          context.repository.listServiceTransactions(context.organisation.id),
          supabase.rpc("club_get_member_billing", { p_organisation_id: context.organisation.id, p_user_id: user.id }),
          context.repository.listProducts(context.organisation.id, true),
        ]);
        const value = <T,>(index: number, fallback: T): T => results[index]?.status === "fulfilled" ? results[index].value as T : fallback;
        const billingResult = value(6, { data: [] as unknown[] });
        const products = value(7, [] as Awaited<ReturnType<typeof context.repository.listProducts>>);
        const customerId = profile.customer?.id;
        const bookings = customerId ? value<ClubClassBooking[]>(4, []).filter(item => item.customerId === customerId) : [];
        const serviceTransactions = customerId ? value<ClubServiceTransaction[]>(5, []).filter(item => item.customerId === customerId) : [];
        const sessions = value<ClubClassSession[]>(2, []).filter(item => item.status === "scheduled" && new Date(item.startsAt).getTime() >= Date.now()).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
        return <ClubMemberHome organisation={context.organisation} role={role} contexts={navContexts} profile={profile} balance={value(0, undefined)} locations={value(1, [])} sessions={sessions} orders={value(3, [])} bookings={bookings} serviceTransactions={serviceTransactions} billing={Array.isArray(billingResult.data) ? billingResult.data as Array<{ state?: string; amount_minor?: number; currency?: string; next_due_at?: string }> : []} lifetimeProductIds={products.filter(product => product.isLifetime).map(product => product.id)} />;
      } catch (error) {
        const failure = safeLoadFailureFields(error);
        console.error("[club] member workspace load failed", failure);
        return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Club" description="Your Madhouse membership workspace."/><LoadRecovery app="Club member workspace" kind={failure.kind}/></AppShell>;
      }
    }
    const [locations, declarations, sessions, classTypes, canReviewBilling, memberIdentities] = await Promise.all([
      context.repository.listLocations(context.organisation.id),
      context.navigation.cashControls ? context.repository.listCashDeclarations(context.organisation.id) : Promise.resolve([]),
      context.repository.listClassSessions(context.organisation.id),
      context.repository.listClassTypes(context.organisation.id),
      context.navigation.finance ? context.repository.hasCapability(context.organisation.id, user.id, "payments.take") : Promise.resolve(false),
      listLinkedInstructorIdentities(supabase, context.organisation.id),
    ]);
    const glowCarlton = locations.find(location => location.active && location.name.toLowerCase().includes("carlton"));
    const [glowCapability, glowLocationAccess] = await Promise.all([
      supabase.rpc("club_capability_allowed", { p_organisation_id: context.organisation.id, p_user_id: user.id, p_capability: "services.manage" }),
      glowCarlton ? supabase.rpc("club_location_authorized", { p_organisation_id: context.organisation.id, p_location_id: glowCarlton.id }) : Promise.resolve({ data: false, error: null }),
    ]);
    const canOpenGlowZone = Boolean(!glowCapability.error && glowCapability.data === true && glowCarlton && !glowLocationAccess.error && glowLocationAccess.data === true);
    const [billingResult, shelfResult] = await Promise.all([
      canReviewBilling ? supabase.rpc("club_list_membership_billing_attention", { p_organisation_id: context.organisation.id }) : Promise.resolve({ data: null, error: null }),
      supabase.rpc("club_list_collection_shelf_checks", { p_organisation_id: context.organisation.id }),
    ]);
    const billingAttention = !billingResult.error && Array.isArray(billingResult.data) ? billingResult.data.length : 0;
    const shelfAttention = !shelfResult.error && Array.isArray(shelfResult.data) ? shelfResult.data.length : 0;
    const now = Date.now();
    const upcomingSessions = sessions.filter(session => session.status === "scheduled" && new Date(session.startsAt).getTime() >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    const upcoming = upcomingSessions.slice(0, 6);
    const awaiting = declarations.filter(item => item.status === "declared").length;
    const disputes = declarations.filter(item => item.status === "discrepancy").length;
    const attention = [context.navigation.cashControls && awaiting ? { label: `${awaiting} cash ${awaiting === 1 ? "declaration" : "declarations"} need verification`, detail: "Review the location cash box", href: `/club/shop?org=${encodeURIComponent(context.organisation.id)}&view=cash-review` } : null, context.navigation.cashControls && disputes ? { label: `${disputes} cash ${disputes === 1 ? "dispute" : "disputes"} need review`, detail: "Resolve the recorded discrepancy", href: `/club/shop?org=${encodeURIComponent(context.organisation.id)}&view=cash-review` } : null, context.navigation.finance && billingAttention ? { label: `${billingAttention} membership ${billingAttention === 1 ? "payment" : "payments"} need attention`, detail: "Review membership billing", href: `/club/membership-billing?org=${encodeURIComponent(context.organisation.id)}` } : null, shelfAttention ? { label: `${shelfAttention} collection shelf ${shelfAttention === 1 ? "check" : "checks"} due`, detail: "Check parcels physically still present", href: `/club/shop/collections?org=${encodeURIComponent(context.organisation.id)}` } : null].filter(Boolean) as Array<{ label: string; detail: string; href: string }>;
    const nearestSessions = upcoming;
    return <AppShell className="module-page club-page">
      <PageHeader title="Overview" />
      <ClubSectionNav organisation={context.organisation} role={role} contexts={navContexts} locations={locations} locationId={params?.location} />
      {theme.organisationName.toLowerCase() === "madhouse gym" ? <div className={styles.brandBanner + " club-brand-banner"}><Image src="/club-branding/madhouse-club-wide.png" alt="R12 Club × Madhouse Gym" width={1200} height={240} priority sizes="(max-width: 760px) 100vw, 1180px" /></div> : null}
      <section className={overviewStyles.desktopOverview} aria-label="Club management overview">
        <Surface className="club-shift-actions"><div className={overviewStyles.panelHeading}><h3>Shift actions</h3></div><div className={overviewStyles.shiftActions}><Link className={overviewStyles.quickLink} href={`/club/work?org=${encodeURIComponent(context.organisation.id)}`}>My Shift <span aria-hidden="true">›</span></Link>{showMyAccess ? <Link className={overviewStyles.quickLink} href={`/club/my-access?org=${encodeURIComponent(context.organisation.id)}`}>My Access <span aria-hidden="true">›</span></Link> : null}{context.navigation.members ? <Link className={overviewStyles.quickLink} href={`/club/members?org=${encodeURIComponent(context.organisation.id)}`}>Members <span aria-hidden="true">›</span></Link> : null}<Link className={overviewStyles.quickLink} href={`/club/shop?org=${encodeURIComponent(context.organisation.id)}&view=sell`}>Till <span aria-hidden="true">›</span></Link><Link className={overviewStyles.quickLink} href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}>Timetable <span aria-hidden="true">›</span></Link><Link className={overviewStyles.quickLink} href={`/club/checks?org=${encodeURIComponent(context.organisation.id)}${params?.location ? `&location=${encodeURIComponent(params.location)}` : ""}`}>Daily Checks <span aria-hidden="true">›</span></Link>{canOpenGlowZone ? <Link className={overviewStyles.quickLink} href={`/club/sunbeds?org=${encodeURIComponent(context.organisation.id)}`}>Glow Zone <span aria-hidden="true">›</span></Link> : null}</div></Surface>
        <div className={overviewStyles.mainGrid}>
          <div className={overviewStyles.column}><Surface><div className={overviewStyles.panelHeading}><h3>Operational alerts</h3></div>{attention.length ? <div className={overviewStyles.attentionList}>{attention.map(item => <Link className={overviewStyles.attentionItem} href={item.href} key={item.label}><span><strong>{item.label}</strong><small>{item.detail}</small></span><b aria-hidden="true">›</b></Link>)}</div> : <p className={overviewStyles.emptyNote}>Nothing needs attention right now.</p>}</Surface></div>
          <div className={overviewStyles.column}>
            <Surface><div className={overviewStyles.panelHeading}><h3>Upcoming Classes &amp; PT</h3><Link href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}>Timetable</Link></div>{nearestSessions.length ? <div className={overviewStyles.sessionList}>{nearestSessions.map(session => { const venue = locations.find(location => location.id === session.locationId)?.name ?? "Venue not recorded"; const type = classTypes.find(item => item.id === session.classTypeId); const instructor = resolveInstructorName(session.hostUserId, session.instructorAssignmentId, memberIdentities, session.instructorName); const title = displayClassTitle(session.title, type?.name); return <div className={overviewStyles.session} key={session.id}><time dateTime={session.startsAt}>{new Date(session.startsAt).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</time><span><strong>{title}</strong><small>{venue} · {instructor}</small></span></div>; })}</div> : <p className={overviewStyles.emptyNote}>No upcoming sessions are scheduled.</p>}</Surface>
          </div>
        </div>
      </section>
    </AppShell>;
  } catch (error) {
    const failure = safeLoadFailureFields(error);
    console.error("[club] overview load failed", failure);
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Club" description="Operational workspace."/><LoadRecovery app="Club" kind={failure.kind}/></AppShell>;
  }
}
