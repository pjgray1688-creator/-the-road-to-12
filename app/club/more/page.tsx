import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

type Destination = { label: string; href: string };
export default async function ClubMorePage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context?.navigation.management) return <AppShell className="module-page club-page"><PageHeader title="Management" description="Restricted Club administration and configuration." /><EmptyState title="Management access required">Your Club capabilities do not include a management area.</EmptyState><AppNav /></AppShell>;
  const q = `?org=${encodeURIComponent(context.organisation.id)}`;
  const [canImport, canClassSetup] = await Promise.all([
    context.repository.hasCapability(context.organisation.id, user.id, "members.import"),
    Promise.resolve(["gym_admin", "owner"].includes(context.role)),
  ]);
  const groups: Array<{ title: string; items: Destination[] }> = [
    { title: "Finance & cash", items: [
      ...(context.navigation.finance ? [{ label: "Finance & sales", href: `/club/payments${q}` }] : []),
      ...(context.navigation.finance ? [{ label: "Checkout attempts", href: `/club/payments?org=${encodeURIComponent(context.organisation.id)}&view=attempts` }, { label: "Membership billing", href: `/club/membership-billing${q}` }] : []),
      ...(context.navigation.cashControls ? [{ label: "Cash close & verification", href: `/club/shop?org=${encodeURIComponent(context.organisation.id)}&view=cash&till=close` }, { label: "Cash approvals", href: `/club/shop?org=${encodeURIComponent(context.organisation.id)}&view=cash-review` }, { label: "Cash collections", href: `/club/payments/cash-collections${q}` }] : []),
      ...(context.navigation.cashTill ? [{ label: "Refunds & till history", href: `/club/shop?org=${encodeURIComponent(context.organisation.id)}&view=cash&till=log` }] : []),
    ] },
    { title: "People", items: [
      ...(context.navigation.memberships ? [{ label: "Membership administration", href: `/club/memberships${q}` }] : []),
      ...(canImport ? [{ label: "Member imports", href: `/club/members/import${q}` }] : []),
      ...(context.navigation.staff ? [{ label: "Staff & permissions", href: `/club/staff${q}` }] : []),
    ] },
    { title: "Shop", items: [
      ...(context.navigation.suppliers ? [{ label: "Supplier catalogue", href: `/club/shop/supplier-catalogue${q}` }] : []),
      ...(context.navigation.promotions ? [{ label: "Products & pricing", href: `/club/products${q}` }, { label: "Website Shop products", href: `/club/website-shop${q}` }, { label: "Website Shop orders", href: `/club/website-shop/orders${q}` }, { label: "Manage offers", href: `/club/promotions${q}` }] : []),
    ] },
    { title: "Operations & settings", items: [
      ...(context.navigation.services && context.navigation.finance ? [{ label: "Glow Zone management & sales", href: `/club/sunbeds?org=${encodeURIComponent(context.organisation.id)}&view=management` }] : []),
      ...(context.navigation.workReview ? [{ label: "Work submissions", href: `/club/work/review${q}` }] : []),
      ...(context.navigation.venues ? [{ label: "Venues & settings", href: `/club/locations${q}` }, { label: "Shared stations", href: `/club/stations${q}` }] : []),
      ...(canClassSetup ? [{ label: "Class, rota & daily-check setup", href: `/club/classes/setup${q}` }] : []),
      ...(context.navigation.services ? [{ label: "Services & configuration", href: `/club/services${q}` }] : []),
    ] },
    { title: "Reports & audit", items: [
      ...(context.navigation.reports ? [{ label: "Reports & audit", href: `/club/reports${q}` }] : []),
    ] },
  ].filter(group => group.items.length > 0);
  return <AppShell className="module-page club-page club-management-home">
    <PageHeader title="Management" />
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />
    <div className="club-management-groups">{groups.map(group => <Surface key={group.title}><h2>{group.title}</h2><div className="club-management-links">{group.items.map(item => <Link key={item.href} href={item.href}>{item.label}<span aria-hidden="true">›</span></Link>)}</div></Surface>)}</div>
    <AppNav />
  </AppShell>;
}
