/* eslint-disable react-hooks/error-boundaries, react-hooks/purity */
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import styles from "@/components/club-operations.module.css";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { clubRepository } from "@/lib/club-repository";
import { listClubOrganisationContexts, isClubStaffRole } from "@/lib/club-server-context";
import { resolveOrganisationTheme } from "@/lib/club";

const roleLabel = (role: string) => role.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());

export default async function ClubPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  try {
    clubRepository(supabase);
    const contexts = await listClubOrganisationContexts(supabase, user.id);
    const orgId = (await searchParams)?.org;
    const context = orgId ? contexts.find(item => item.organisation.id === orgId) : contexts.length === 1 ? contexts[0] : undefined;
    if (!context) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Choose your organisation" description="Select the gym workspace you want to use." />{contexts.length ? <Surface><div className={styles.quickGrid}>{contexts.map(item => <Link key={item.organisation.id} href={`/club?org=${encodeURIComponent(item.organisation.id)}`}><strong>{item.organisation.name}</strong><small>{roleLabel(item.role)} · Open workspace</small></Link>)}</div></Surface> : <EmptyState title="Club access required">Your account is not linked to an active Club organisation.</EmptyState>}<AppNav /></AppShell>;
    const theme = resolveOrganisationTheme(context.organisation);
    const role = context.role;
    if (!isClubStaffRole(role)) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title={theme.organisationName} description="Your Club member workspace." /><ClubSectionNav organisation={context.organisation} role={role} contexts={contexts} /><Surface><span className="eyebrow">YOUR CLUB</span><div className={styles.quickGrid}><Link href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}><strong>Classes</strong><small>View timetable and availability</small></Link><Link href={`/club/shop?org=${encodeURIComponent(context.organisation.id)}`}><strong>Shop</strong><small>Browse products and your orders</small></Link></div></Surface><AppNav /></AppShell>;
    const [members, locations, products, services, declarations, sessions, orders] = await Promise.all([context.repository.listMembers(context.organisation.id), context.repository.listLocations(context.organisation.id), context.repository.listCommerceProducts(context.organisation.id), context.repository.listServices(context.organisation.id), context.repository.listCashDeclarations(context.organisation.id), context.repository.listClassSessions(context.organisation.id), context.repository.listOrders(context.organisation.id)]);
    const now = Date.now();
    const upcoming = sessions.filter(session => session.status === "scheduled" && new Date(session.startsAt).getTime() >= now).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 4);
    const awaiting = declarations.filter(item => item.status === "declared").length;
    const disputes = declarations.filter(item => item.status === "discrepancy").length;
    const attention = [awaiting ? { label: `${awaiting} cash ${awaiting === 1 ? "declaration" : "declarations"} need verification`, detail: "Review the location cash box", href: `/club/shop?org=${encodeURIComponent(context.organisation.id)}` } : null, disputes ? { label: `${disputes} cash ${disputes === 1 ? "dispute" : "disputes"} need review`, detail: "Resolve the recorded discrepancy", href: `/club/shop?org=${encodeURIComponent(context.organisation.id)}` } : null].filter(Boolean) as Array<{ label: string; detail: string; href: string }>;
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · OPERATIONS" title={theme.organisationName} description="A clear view of what needs attention today." /><ClubSectionNav organisation={context.organisation} role={role} contexts={contexts} /><div className={styles.overview}><Surface className={attention.length ? styles.attention : ""}><span className="eyebrow">NEEDS ATTENTION</span>{attention.length ? <div className={styles.attentionList}>{attention.map(item => <Link className={styles.attentionItem} href={item.href} key={item.label}><span><strong>{item.label}</strong><small>{item.detail}</small></span><b aria-hidden="true">›</b></Link>)}</div> : <p className="muted" style={{ marginTop: 12 }}>Nothing needs attention right now.</p>}</Surface><Surface><span className="eyebrow">QUICK ACCESS</span><div className={styles.quickGrid}><Link href={`/club/members?org=${encodeURIComponent(context.organisation.id)}`}><strong>Members</strong><small>{members.filter(member => member.active).length} active records</small></Link><Link href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}><strong>Classes</strong><small>{upcoming.length ? `${upcoming.length} coming up` : "No upcoming classes"}</small></Link><Link href={`/club/reception?org=${encodeURIComponent(context.organisation.id)}`}><strong>Reception</strong><small>{products.length} products · {orders.length} orders</small></Link><Link href={`/club/shop?org=${encodeURIComponent(context.organisation.id)}`}><strong>Shop</strong><small>Front-desk products and sales</small></Link><Link href={`/club/services?org=${encodeURIComponent(context.organisation.id)}`}><strong>Services</strong><small>{services.filter(service => service.active).length} active services</small></Link><Link href={`/club/locations?org=${encodeURIComponent(context.organisation.id)}`}><strong>Locations</strong><small>{locations.filter(location => location.active).length} active sites</small></Link></div></Surface><Surface><span className="eyebrow">UP NEXT</span>{upcoming.length ? upcoming.map(session => <div className="club-detail-row" key={session.id}><span>{session.title ?? "Scheduled class"}</span><span className="muted">{new Date(session.startsAt).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span></div>) : <p className="muted" style={{ marginTop: 12 }}>No upcoming classes scheduled.</p>}</Surface></div><AppNav /></AppShell>;
  } catch { return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Club" description="Operational workspace." /><EmptyState title="Club couldn’t be loaded.">Try again shortly.</EmptyState><AppNav /></AppShell>; }
}
