import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

type Destination = { label: string; href: string };
const sectionLabels: Record<string, string> = {
  finance: "Finance & Payments",
  staff: "Staff & Rota",
  membership: "Membership Administration",
  shop: "Shop Administration",
  venues: "Venues & Settings",
};
export default async function ClubMorePage({ searchParams }: { searchParams?: Promise<{ org?: string; section?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context?.navigation.management) return <AppShell className="module-page club-page"><PageHeader title="Management" description="Restricted Club administration and configuration." /><EmptyState title="Management access required">Your Club capabilities do not include a management area.</EmptyState><AppNav /></AppShell>;
  const q = `?org=${encodeURIComponent(context.organisation.id)}`;
  const [canImport, canClassSetup] = await Promise.all([
    context.repository.hasCapability(context.organisation.id, user.id, "members.import"),
    Promise.resolve(["gym_admin", "owner"].includes(context.role)),
  ]);
  const glowLocations = context.organisation.slug === "madhouse-gym" && context.navigation.services
    ? await context.repository.listLocations(context.organisation.id).catch(() => [])
    : [];
  const carlton = glowLocations.find(location => location.active && location.name.toLocaleLowerCase("en-GB").includes("carlton"));
  const glowAccess = carlton
    ? await client.rpc("club_location_authorized", { p_organisation_id: context.organisation.id, p_location_id: carlton.id })
    : { data: false, error: null };
  const canManageGlowZone = context.navigation.services && context.navigation.management && context.navigation.finance && !glowAccess.error && glowAccess.data === true;
  const groups: Array<{ title: string; key: string; items: Destination[] }> = [
    { title: sectionLabels.finance, key: "finance", items: [
      ...(context.navigation.finance ? [{ label: "Finance & sales", href: `/club/payments${q}` }] : []),
      ...(context.navigation.finance ? [{ label: "Checkout attempts", href: `/club/payments?org=${encodeURIComponent(context.organisation.id)}&view=attempts` }, { label: "Membership billing", href: `/club/membership-billing${q}` }] : []),
      ...(context.navigation.cashControls ? [{ label: "Cash close & verification", href: `/club/shop?org=${encodeURIComponent(context.organisation.id)}&view=cash&till=close` }, { label: "Cash approvals", href: `/club/shop?org=${encodeURIComponent(context.organisation.id)}&view=cash-review` }, { label: "Cash collections", href: `/club/payments/cash-collections${q}` }] : []),
      ...(context.navigation.cashTill ? [{ label: "Refunds & till history", href: `/club/shop?org=${encodeURIComponent(context.organisation.id)}&view=cash&till=log` }] : []),
      ...(canManageGlowZone ? [{ label: "Glow Zone reporting & balances", href: `/club/sunbeds?org=${encodeURIComponent(context.organisation.id)}&view=management` }] : []),
      ...(context.navigation.reports ? [{ label: "Reports & audit", href: `/club/reports${q}` }] : []),
    ] },
    { title: sectionLabels.staff, key: "staff", items: [
      ...(context.navigation.staff ? [{ label: "Staff & permissions", href: `/club/staff${q}` }] : []),
      ...(context.navigation.workReview ? [{ label: "Work submissions", href: `/club/work/review${q}` }] : []),
      ...(canClassSetup ? [{ label: "Recurring classes, rota & checks", href: `/club/classes/setup${q}` }] : []),
    ] },
    { title: sectionLabels.membership, key: "membership", items: [
      ...(context.navigation.memberships ? [{ label: "Membership administration", href: `/club/memberships${q}` }] : []),
      ...(canImport ? [{ label: "Member imports", href: `/club/members/import${q}` }] : []),
    ] },
    { title: sectionLabels.shop, key: "shop", items: [
      ...(context.navigation.suppliers ? [{ label: "Supplier catalogue", href: `/club/shop/supplier-catalogue${q}` }] : []),
      ...(context.navigation.promotions ? [{ label: "Products & pricing", href: `/club/products${q}` }, { label: "Website Shop", href: `/club/website-shop${q}` }, { label: "Promotions & offers", href: `/club/promotions${q}` }] : []),
    ] },
    { title: sectionLabels.venues, key: "venues", items: [
      ...(context.navigation.venues ? [{ label: "Venues & settings", href: `/club/locations${q}` }] : []),
      ...(context.navigation.staff ? [{ label: "Shared stations", href: `/club/stations${q}` }] : []),
      ...(context.navigation.services ? [{ label: "Services & configuration", href: `/club/services${q}` }] : []),
    ] },
  ].filter(group => group.items.length > 0);
  const params = await searchParams;
  const requestedSection = params?.section && sectionLabels[params.section] ? params.section : undefined;
  const selectedGroup = requestedSection ? groups.find(group => group.key === requestedSection) : undefined;
  const visibleGroups = requestedSection ? (selectedGroup ? [selectedGroup] : []) : groups;
  return <AppShell className="module-page club-page club-management-home">
    <PageHeader title={selectedGroup?.title ?? "Management"} />
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />
    {selectedGroup ? <Link className="secondary club-management-back" href={`/club/more${q}`}>Back to Management</Link> : null}
    {visibleGroups.length ? <div className="club-management-groups">{visibleGroups.map(group => <Surface key={group.key}><h2>{group.title}</h2><div className="club-management-links">{group.items.map(item => <Link key={item.href} href={item.href}>{item.label}<span aria-hidden="true">›</span></Link>)}</div></Surface>)}</div> : <EmptyState title="No actions available">Your current management permissions do not include actions in this section.</EmptyState>}
    <AppNav />
  </AppShell>;
}
