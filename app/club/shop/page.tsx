import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { clubRepository } from "@/lib/club-repository";
import { resolveOrganisationTheme } from "@/lib/club";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { ClubShop } from "@/components/club-shop";
import { ClubStaffCheckout } from "@/components/club-staff-checkout";

async function loadShop(client: Awaited<ReturnType<typeof serverSupabase>>, userId: string) {
  const repository = clubRepository(client); const organisations = await repository.listOrganisations();
  for (const organisation of organisations) {
    const members = await repository.listMembers(organisation.id); const member = members.find(item => item.userId === userId && item.active); if (!member) continue;
    const [products, locations, balance, orders, declarations] = await Promise.all([repository.listCommerceProducts(organisation.id), repository.listLocations(organisation.id), repository.getBalanceAccount(organisation.id, userId), repository.listOrders(organisation.id), ["gym_staff", "gym_admin", "owner"].includes(member.role) ? repository.listCashDeclarations(organisation.id, "declared") : Promise.resolve([])]);
    return { organisation, products, locations, balance, orders, declarations, staff: ["gym_staff", "gym_admin", "owner"].includes(member.role) };
  }
  return undefined;
}

export default async function ClubShopPage() {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  let loaded; try { loaded = await loadShop(client, user.id); } catch { loaded = "error" as const; }
  if (loaded === "error") return <AppShell className="module-page club-shop-page"><PageHeader eyebrow="R12 CLUB" title="Shop" description="Commerce is temporarily unavailable." /><EmptyState title="Shop couldn’t be loaded.">Try again shortly.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
  if (!loaded) return <AppShell className="module-page club-shop-page"><PageHeader eyebrow="R12 CLUB" title="Shop" description="Organisation commerce." /><EmptyState title="Club access required">Your account is not linked to an active Club organisation.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
  const theme = resolveOrganisationTheme(loaded.organisation);
  return <AppShell className="module-page club-shop-page"><PageHeader eyebrow="R12 CLUB · COMMERCE" title={theme.organisationName} description="Shop, payments and cash verification." />{loaded.staff ? <ClubStaffCheckout products={loaded.products} locations={loaded.locations} /> : null}<ClubShop organisationId={loaded.organisation.id} userId={user.id} products={loaded.products} locations={loaded.locations} balance={loaded.balance} orders={loaded.orders.filter(order => order.userId === user.id)} declarations={loaded.declarations} staff={loaded.staff} accent={theme.primaryAccent} /><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
}
