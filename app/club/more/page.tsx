import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

export default async function ClubMorePage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context?.navigation.management) return <AppShell className="module-page club-page"><PageHeader title="Management" /><EmptyState title="Management access required">Your Club capabilities do not include a management area.</EmptyState><AppNav /></AppShell>;
  const q = `?org=${encodeURIComponent(context.organisation.id)}`;
  const sections = [
    context.navigation.finance && ["Finance & reconciliation", "/club/payments", "Transactions, payment exceptions and cash review."],
    context.navigation.memberships && ["Membership administration", "/club/members", "Products, contracts, holders and payment evidence."],
    context.navigation.promotions && ["Promotions & pricing", "/club/promotions", "Manage valid offers and controlled pricing."],
    context.navigation.suppliers && ["Suppliers & purchasing", "/club/suppliers", "Supplier catalogue, orders and receiving."],
    context.navigation.staff && ["Staff & permissions", "/club/staff", "Manage staff access and explicit capabilities."],
    context.navigation.venues && ["Venues & settings", "/club/locations", "Review operational locations and shared stations."],
    context.navigation.reports && ["Reports & audit", "/club/reports", "Restricted reporting and exports."],
    context.navigation.services && ["Services & configuration", "/club/services", "Manage Club service availability."],
  ].filter(Boolean) as string[][];
  return <AppShell className="module-page club-page">
    <PageHeader title="Management" description="Restricted Club administration, finance and configuration." />
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />
    <Surface><div className="club-profile-grid">{sections.map(([label, href, description]) => <Link className="club-detail-row" href={`${href}${q}`} key={href}><strong>{label}</strong><span className="muted">{description}</span></Link>)}</div></Surface>
    <BackButton href={`/club${q}`}>Back to overview</BackButton><AppNav />
  </AppShell>;
}
