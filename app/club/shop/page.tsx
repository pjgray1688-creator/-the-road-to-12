import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveOrganisationTheme } from "@/lib/club";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { ClubShop } from "@/components/club-shop";
import { ClubStaffCheckout } from "@/components/club-staff-checkout";
import { ClubSectionNav } from "@/components/club-shell";

async function loadShop(client: Awaited<ReturnType<typeof serverSupabase>>, userId: string, organisationId?: string) {
  const context = await resolveClubOrganisationContext(client, userId, organisationId);
  if (!context) return undefined;
  const { repository, organisation, member } = context;
  const staff = ["gym_staff", "gym_admin", "owner"].includes(member.role);
  const [products, locations, balance, orders, declarations, customers] = await Promise.all([repository.listCommerceProducts(organisation.id), repository.listLocations(organisation.id), repository.getBalanceAccount(organisation.id, userId), repository.listOrders(organisation.id), staff ? repository.listCashDeclarations(organisation.id, "declared") : Promise.resolve([]), staff ? repository.listCustomers(organisation.id) : Promise.resolve([])]);
  return { organisation, products, locations, balance, orders, declarations, customers, staff, role: member.role };
}

export default async function ClubShopPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const params = await searchParams; let loaded; try { loaded = await loadShop(client, user.id, params?.org); } catch { loaded = "error" as const; }
  if (loaded === "error") return <AppShell className="module-page club-shop-page"><PageHeader eyebrow="R12 CLUB" title="Shop" description="Commerce is temporarily unavailable." /><EmptyState title="Shop couldn’t be loaded.">Try again shortly.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
  if (!loaded) return <AppShell className="module-page club-shop-page"><PageHeader eyebrow="R12 CLUB" title="Shop" description="Organisation commerce." /><EmptyState title="Club access required">Your account is not linked to an active Club organisation.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
  const theme = resolveOrganisationTheme(loaded.organisation);
  return <AppShell className="module-page club-shop-page"><PageHeader eyebrow="R12 CLUB · COMMERCE" title={theme.organisationName} description="Reception sales, member purchases and cash verification." /><ClubSectionNav organisation={loaded.organisation} role={loaded.role} /><>{loaded.staff ? <ClubStaffCheckout organisationId={loaded.organisation.id} products={loaded.products} locations={loaded.locations} customers={loaded.customers} /> : null}<ClubShop organisationId={loaded.organisation.id} userId={user.id} products={loaded.products} locations={loaded.locations} balance={loaded.balance} orders={loaded.orders.filter(order => order.userId === user.id)} declarations={loaded.declarations} staff={loaded.staff} accent={theme.primaryAccent} /></><BackButton href={`/club?org=${encodeURIComponent(loaded.organisation.id)}`}>Back to Club</BackButton><AppNav /></AppShell>;
}
