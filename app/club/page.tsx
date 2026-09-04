/* eslint-disable react-hooks/error-boundaries, react-hooks/purity */
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { ClubSectionNav } from "@/components/club-shell";
import styles from "@/components/club-operations.module.css";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { listClubOrganisationContexts, isClubStaffRole, toClubNavContexts } from "@/lib/club-server-context";
import { resolveOrganisationTheme } from "@/lib/club";
import type { Metadata } from "next";
import { clubMetadata } from "@/lib/club-metadata";

const roleLabel = (role: string) => role.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());

export async function generateMetadata({ searchParams }: { searchParams?: Promise<{ org?: string }> }): Promise<Metadata> {
  try {
    const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
    if (!user) return clubMetadata("Overview");
    const contexts = await listClubOrganisationContexts(supabase, user.id); const orgId = (await searchParams)?.org; const organisation = contexts.find(item => item.organisation.id === orgId)?.organisation ?? (contexts.length === 1 ? contexts[0].organisation : undefined);
    return clubMetadata("Overview", organisation?.name);
  } catch { return clubMetadata("Overview"); }
}

export default async function ClubPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { const params = await searchParams; const next = `/club${params?.org ? `?org=${encodeURIComponent(params.org)}` : ""}`; redirect(`/account?mode=signIn&next=${encodeURIComponent(next)}`); }
  try {
    const contexts = await listClubOrganisationContexts(supabase, user.id);
    const orgId = (await searchParams)?.org;
    const context = orgId ? contexts.find(item => item.organisation.id === orgId) : contexts.length === 1 ? contexts[0] : undefined;
    if (!context) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Choose your organisation" description="Select the gym workspace you want to use." />{contexts.length ? <Surface><div className={styles.quickGrid}>{contexts.map(item => <Link key={item.organisation.id} href={`/club?org=${encodeURIComponent(item.organisation.id)}`}><strong>{item.organisation.name}</strong><small>{roleLabel(item.role)} · Open workspace</small></Link>)}</div></Surface> : <EmptyState title="Club access required">Your account is not linked to an active Club organisation.</EmptyState>}</AppShell>;
    const theme = resolveOrganisationTheme(context.organisation);
    const role = context.role;
    const navContexts = toClubNavContexts(contexts);
    if (!isClubStaffRole(role)) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title={theme.organisationName} description="Your Club member workspace." /><ClubSectionNav organisation={context.organisation} role={role} contexts={navContexts} /><Surface><span className="eyebrow">YOUR CLUB</span><div className={styles.quickGrid}><Link href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}><strong>Classes</strong><small>View timetable and availability</small></Link><Link href={`/club/shop?org=${encodeURIComponent(context.organisation.id)}`}><strong>Shop</strong><small>Browse products and your orders</small></Link></div></Surface></AppShell>;
    const [members, locations, products, services, declarations, sessions, orders] = await Promise.all([context.repository.listMembers(context.organisation.id), context.repository.listLocations(context.organisation.id), context.repository.listCommerceProducts(context.organisation.id), context.repository.listServices(context.organisation.id), context.repository.listCashDeclarations(context.organisation.id), context.repository.listClassSessions(context.organisation.id), context.repository.listOrders(context.organisation.id)]);
    const billingResult = await supabase.rpc("club_list_membership_billing_attention", { p_organisation_id: context.organisation.id });
    const billingAttention = !billingResult.error && Array.isArray(billingResult.data) ? billingResult.data.length : 0;
    const shelfResult = await supabase.rpc("club_list_collection_shelf_checks", { p_organisation_id: context.organisation.id });
    const shelfAttention = !shelfResult.error && Array.isArray(shelfResult.data) ? shelfResult.data.length : 0;
    const now = Date.now();
    const upcoming = sessions.filter(session => session.status === "scheduled" && new Date(session.startsAt).getTime() >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 4);
    const awaiting = declarations.filter(item => item.status === "declared").length;
    const disputes = declarations.filter(item => item.status === "discrepancy").length;
    const attention = [awaiting ? { label: `${awaiting} cash ${awaiting === 1 ? "declaration" : "declarations"} need verification`, detail: "Review the location cash box", href: `/club/shop?org=${encodeURIComponent(context.organisation.id)}` } : null, disputes ? { label: `${disputes} cash ${disputes === 1 ? "dispute" : "disputes"} need review`, detail: "Resolve the recorded discrepancy", href: `/club/shop?org=${encodeURIComponent(context.organisation.id)}` } : null, billingAttention ? { label: `${billingAttention} membership ${billingAttention === 1 ? "payment" : "payments"} need attention`, detail: "Review failed payments and recovery", href: `/club/payments?org=${encodeURIComponent(context.organisation.id)}` } : null, shelfAttention ? { label: `${shelfAttention} collection shelf ${shelfAttention === 1 ? "check" : "checks"} due`, detail: "Check parcels physically still present", href: `/club/shop/collections?org=${encodeURIComponent(context.organisation.id)}` } : null].filter(Boolean) as Array<{ label: string; detail: string; href: string }>;
    const isMadhouse = theme.organisationName.toLowerCase() === "madhouse gym";
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · OPERATIONS" title="Overview" description={`${theme.organisationName} operations at a glance.`} /><ClubSectionNav organisation={context.organisation} role={role} contexts={navContexts} />{isMadhouse ? <div className={styles.brandBanner}><Image src="/club-branding/madhouse-club-wide.png" alt="R12 Club × Madhouse Gym" width={1200} height={240} priority sizes="(max-width: 760px) 100vw, 1180px" /></div> : null}<div className={styles.overview}><Surface className={attention.length ? styles.attention : ""}><span className="eyebrow">NEEDS ATTENTION</span>{attention.length ? <div className={styles.attentionList}>{attention.map(item => <Link className={styles.attentionItem} href={item.href} key={item.label}><span><strong>{item.label}</strong><small>{item.detail}</small></span><b aria-hidden="true">›</b></Link>)}</div> : <p className="muted" style={{ marginTop: 12 }}>Nothing needs attention right now.</p>}</Surface><Surface><span className="eyebrow">QUICK ACCESS</span><div className={styles.quickGrid}><Link href={`/club/members?org=${encodeURIComponent(context.organisation.id)}`}><strong>Members</strong><small>{members.filter(member => member.active).length} active records</small></Link><Link href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}><strong>Classes</strong><small>{upcoming.length ? `${upcoming.length} coming up` : "No upcoming classes"}</small></Link><Link href={`/club/reception?org=${encodeURIComponent(context.organisation.id)}`}><strong>Reception</strong><small>Find and onboard people</small></Link><Link href={`/club/services?org=${encodeURIComponent(context.organisation.id)}`}><strong>Services</strong><small>{services.filter(service => service.active).length} active services</small></Link><Link href={`/club/locations?org=${encodeURIComponent(context.organisation.id)}`}><strong>Locations</strong><small>{locations.filter(location => location.active).length} active sites</small></Link></div></Surface><Surface><span className="eyebrow">UP NEXT</span>{upcoming.length ? upcoming.map(session => <div className="club-detail-row" key={session.id}><span>{session.title ?? "Scheduled class"}</span><span className="muted">{new Date(session.startsAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span></div>) : <p className="muted" style={{ marginTop: 12 }}>No upcoming classes scheduled.</p>}</Surface></div></AppShell>;
  } catch { return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Club" description="Operational workspace." /><EmptyState title="Club couldn’t be loaded.">Try again shortly.</EmptyState></AppShell>; }
}
