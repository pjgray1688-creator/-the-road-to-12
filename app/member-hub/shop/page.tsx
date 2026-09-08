import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { clubRepository } from "@/lib/club-repository";
import { ClubShop } from "@/components/club-shop";
import { AppShell, EmptyState, PageHeader } from "@/components/ui";
import { resolveOrganisationTheme } from "@/lib/club";
import type { PromotionRule } from "@/lib/club-promotions";
import { durableSupplierRowsToProducts, type DurableSupplierParentRow } from "@/lib/club-supplier-catalogue";

export default async function MemberHubShop({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fmember-hub%2Fshop");
  const params = await searchParams; const { data } = await client.rpc("club_list_my_memberships");
  const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  const row = rows.find(value => String((value.organisation as Record<string, unknown> | undefined)?.id) === params?.org) ?? rows[0];
  if (!row) return <AppShell className="module-page member-area-page"><PageHeader title="Shop" /><EmptyState title="Connect your gym first">Your member shop will appear once a membership is linked.</EmptyState></AppShell>;
  const org = row.organisation as Record<string, unknown>; const organisationId = String(org.id); const repository = clubRepository(client);
  const [localProducts, locations, balance, orders, promotionRows, supplierRows, enrichmentRows] = await Promise.all([repository.listCommerceProducts(organisationId), repository.listLocations(organisationId), repository.getMemberOperationalProfile(organisationId, user.id).then(profile => profile.customer ? repository.getBalanceAccountForCustomer(organisationId, profile.customer.id) : undefined), repository.listOrders(organisationId), client.from("club_promotions").select("id,status,starts_at,ends_at,location_ids,effects,eligibility").eq("organisation_id", organisationId).eq("status", "active"), client.rpc("club_list_member_supplier_catalogue", { p_organisation_id: organisationId, p_location_id: null }), client.rpc("club_list_member_supplier_enrichment", { p_organisation_id: organisationId })]);
  const supplierParents = Array.isArray(supplierRows.data) ? supplierRows.data as DurableSupplierParentRow[] : [];
  const enrichment = new Map((Array.isArray(enrichmentRows.data) ? enrichmentRows.data : []).map((item) => { const value = item as Record<string, unknown>; return [String(value.variantId), value]; }));
  const supplierProducts = durableSupplierRowsToProducts(supplierParents, organisationId).map(product => { const info = enrichment.get(product.id); return info ? { ...product, description: typeof info.description === "string" ? info.description : product.description, media: typeof info.variantImageUrl === "string" ? { url: info.variantImageUrl } : product.media, enrichment: { nutrition: info.nutrition, ingredients: info.ingredients, allergens: info.allergens } } : product; });
  const products = [...localProducts, ...supplierProducts.filter(product => !localProducts.some(existing => existing.id === product.id))];
  const promotions = (Array.isArray(promotionRows.data) ? promotionRows.data : []).map(value => { const item = value as Record<string, unknown>; return { id: String(item.id), status: "active" as const, startsAt: String(item.starts_at), ...(item.ends_at ? { endsAt: String(item.ends_at) } : {}), ...(Array.isArray(item.location_ids) ? { locationIds: item.location_ids.map(String) } : {}), effect: "percentage" as const, eligibility: item.eligibility } satisfies PromotionRule & { eligibility?: unknown }; }).filter(rule => new Date(rule.startsAt) <= new Date() && (!rule.endsAt || new Date() < new Date(rule.endsAt)));
  const memberLocation = locations.find(location => location.active); const stockBalances = memberLocation ? await repository.listStockBalances(organisationId, memberLocation.id) : [];
  return <AppShell className="module-page club-page member-area-page member-shop-page"><PageHeader title="Shop" /><ClubShop organisationId={organisationId} userId={user.id} products={products} locations={locations} balance={balance} stockBalances={stockBalances} promotions={promotions} orders={orders.filter(order => order.userId === user.id)} declarations={[]} staff={false} canReconcile={false} accent={resolveOrganisationTheme({ id: organisationId, name: String(org.name), slug: String(org.slug), active: true }).primaryAccent} /><a className="back-button" href="/member-hub">Back to Member Area</a></AppShell>;
}
