import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveOrganisationTheme } from "@/lib/club";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { ClubShop } from "@/components/club-shop";
import { ClubStaffCheckout } from "@/components/club-staff-checkout";
import { ClubStockPanel } from "@/components/club-stock-panel";
import { ClubCatalogue } from "@/components/club-catalogue";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubShopTabs } from "@/components/club-shop-tabs";
import { ClubCatalogueImport } from "@/components/club-catalogue-import";
import { ClubDeliveryHistory } from "@/components/club-delivery-history";

async function loadShop(client: Awaited<ReturnType<typeof serverSupabase>>, userId: string, organisationId?: string, locationId?: string) {
  const context = await resolveClubOrganisationContext(client, userId, organisationId);
  if (!context) return undefined;
  const { repository, organisation, member } = context;
  const staff = ["gym_staff", "gym_admin", "owner"].includes(member.role);
  const [products, locations, balance, orders, declarations, customers, canRecordCash, canReconcile, deliveries] = await Promise.all([repository.listCommerceProducts(organisation.id), repository.listLocations(organisation.id), repository.getBalanceAccount(organisation.id, userId), repository.listOrders(organisation.id), staff ? repository.listCashDeclarations(organisation.id, "declared") : Promise.resolve([]), staff ? repository.listCustomers(organisation.id) : Promise.resolve([]), staff ? repository.hasCapability(organisation.id, userId, "payments.record_cash") : Promise.resolve(false), staff ? repository.hasCapability(organisation.id, userId, "cash.reconcile") : Promise.resolve(false), staff ? repository.listInventoryReceipts(organisation.id, locationId) : Promise.resolve([])]);
  const activeLocation = locations.find(location => location.active && location.id === locationId) ?? (member.role === "gym_staff" ? locations.find(location => location.active) : undefined);
  const stockBalances = staff ? await repository.listStockBalances(organisation.id, activeLocation?.id) : [];
  const canAdjustStock = staff ? await repository.hasCapability(organisation.id, userId, "inventory.adjust") : false;
  const canManageCatalogue = member.role === "gym_admin" || member.role === "owner";
  return { organisation, products, locations, activeLocation, stockBalances, balance, orders, declarations, customers, deliveries, staff, canRecordCash, canReconcile, canAdjustStock, canManageCatalogue, role: member.role, contexts: context.availableContexts };
}

export default async function ClubShopPage({ searchParams }: { searchParams?: Promise<{ org?: string; location?: string; view?: string }> }) {
  const client = await serverSupabase(); const params = await searchParams; const { data: { user } } = await client.auth.getUser();
  if (!user) {
    const query = new URLSearchParams();
    if (params?.org) query.set("org", params.org);
    if (params?.location) query.set("location", params.location);
    if (params?.view) query.set("view", params.view);
    const returnTo = `/club/shop${query.toString() ? `?${query.toString()}` : ""}`;
    redirect(`/account?mode=signIn&next=${encodeURIComponent(returnTo)}`);
  }
  let loaded; try { loaded = await loadShop(client, user.id, params?.org, params?.location); } catch { loaded = "error" as const; }
  if (loaded === "error") return <AppShell className="module-page club-shop-page"><PageHeader eyebrow="R12 CLUB" title="Shop" description="Commerce is temporarily unavailable." /><EmptyState title="Shop couldn’t be loaded.">Try again shortly.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
  if (!loaded) return <AppShell className="module-page club-shop-page"><PageHeader eyebrow="R12 CLUB" title="Shop" description="Organisation commerce." /><EmptyState title="Club access required">Your account is not linked to an active Club organisation.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
  const theme = resolveOrganisationTheme(loaded.organisation);
  const fulfilmentStates: Record<string, string> = {};
  if (!loaded.staff) {
    const { data: fulfilment } = await client.rpc("club_list_member_supplier_fulfilment", { p_organisation_id: loaded.organisation.id, p_user_id: user.id });
    if (Array.isArray(fulfilment)) for (const item of fulfilment as Array<Record<string, unknown>>) if (item.order_id && item.status) fulfilmentStates[String(item.order_id)] = String(item.status);
  }
  const view = params?.view && ["sell", "stock", "catalogue", "cash"].includes(params.view) ? params.view : "sell";
  return <AppShell className="module-page club-shop-page"><PageHeader eyebrow="R12 CLUB · COMMERCE" title="Shop" description={loaded.staff ? "Sell, stock, catalogue and cash." : "Browse products and manage your purchases."} /><ClubSectionNav organisation={loaded.organisation} role={loaded.role} contexts={loaded.contexts} locations={loaded.locations} locationId={loaded.activeLocation?.id} /><>{loaded.staff ? <ClubShopTabs organisationId={loaded.organisation.id} locationId={loaded.activeLocation?.id} view={view} /> : null}</><>{loaded.staff && view === "sell" ? <ClubStaffCheckout organisationId={loaded.organisation.id} products={loaded.products} locations={loaded.locations} customers={loaded.customers} canRecordCash={loaded.canRecordCash} currentLocationId={loaded.activeLocation?.id} /> : null}{!loaded.staff && view === "sell" ? <ClubShop organisationId={loaded.organisation.id} userId={user.id} products={loaded.products} locations={loaded.locations} balance={loaded.balance} orders={loaded.orders.filter(order => order.userId === user.id)} declarations={[]} staff={false} canReconcile={false} accent={theme.primaryAccent} currentLocationId={loaded.activeLocation?.id} fulfilmentStates={fulfilmentStates} /> : null}{loaded.staff && view === "stock" ? <><ClubStockPanel organisationId={loaded.organisation.id} products={loaded.products} locations={loaded.locations} balances={loaded.stockBalances} locationId={loaded.activeLocation?.id} canAdjust={loaded.canAdjustStock} /><ClubDeliveryHistory receipts={loaded.deliveries} locations={loaded.locations} /></> : null}{loaded.staff && view === "catalogue" && loaded.canManageCatalogue ? <><ClubCatalogue organisationId={loaded.organisation.id} products={loaded.products} /><ClubCatalogueImport organisationId={loaded.organisation.id} products={loaded.products} /></> : null}{loaded.staff && view === "cash" ? <ClubShop organisationId={loaded.organisation.id} userId={user.id} products={loaded.products} locations={loaded.locations} balance={loaded.balance} orders={loaded.orders.filter(order => order.userId === user.id)} declarations={loaded.declarations} staff={loaded.staff} canReconcile={loaded.canReconcile} accent={theme.primaryAccent} currentLocationId={loaded.activeLocation?.id} /> : null}</><BackButton href={`/club?org=${encodeURIComponent(loaded.organisation.id)}`}>Back to Club</BackButton><AppNav /></AppShell>;
}
