import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubSupplierOrders } from "@/components/club-supplier-orders";

type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];
const missingRpc = (error: { code?: string } | null) => error?.code === "PGRST202" || error?.code === "42883";

export default async function SupplierOrdersPage({ searchParams }: { searchParams?: Promise<{ org?: string; location?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");
  const params = await searchParams;
  const context = await resolveClubOrganisationContext(client, user.id, params?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "supplier.orders_manage"))) return <AppShell className="module-page club-page"><PageHeader title="Supplier orders"/><EmptyState title="Access required">Ask an owner to grant supplier-order access.</EmptyState><AppNav/></AppShell>;

  const [demandResult, batchResult, reviewResult, lineResult, locations] = await Promise.all([
    client.rpc("club_list_supplier_demand", { p_organisation_id: context.organisation.id }),
    client.rpc("club_list_supplier_order_batches", { p_organisation_id: context.organisation.id }),
    client.rpc("club_list_replenishment_review", { p_organisation_id: context.organisation.id }),
    client.rpc("club_list_replenishment_lines", { p_organisation_id: context.organisation.id }),
    context.repository.listLocations(context.organisation.id),
  ]);
  const activeLocation = locations.find(location => location.id === params?.location && location.active);
  const demandError = demandResult.error;
  const batches = rows(batchResult.data);
  const review = rows(reviewResult.data).filter(row => !activeLocation || row.location_id === activeLocation.id);
  const replenishmentLines = rows(lineResult.data);
  const distribution = (await Promise.all(batches.map(async batch => {
    const { data, error } = await client.rpc("club_list_replenishment_distribution", { p_organisation_id: context.organisation.id, p_batch_id: String(batch.id) });
    return { batch, rows: rows(data), error };
  }))).map(item => ({ ...item, rows: item.rows.filter(row => !activeLocation || row.location_id === activeLocation.id) })).filter(item => item.rows.length);
  const demand = rows(demandResult.data);
  const configuredError = [demandResult.error, batchResult.error, reviewResult.error, lineResult.error].some(missingRpc);
  const serviceError = [demandResult.error, batchResult.error, reviewResult.error, lineResult.error].some(error => error && !missingRpc(error));

  return <AppShell className="module-page club-page"><PageHeader title="Supplier orders"/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/>
    {activeLocation ? <p className="club-shop-location-note">Showing destination requirements for <strong>{activeLocation.name}</strong>.</p> : null}
    {configuredError ? <EmptyState title="Supplier order pipeline needs configuration">The required supplier-order database functions are not available in this environment.</EmptyState> : serviceError ? <EmptyState title="Supplier order data is temporarily unavailable">No order or demand changes were made. Try again shortly.</EmptyState> : <>
      <Surface><div className="section-header"><div><h2>Replenishment by destination</h2></div></div>{review.length ? <div className="club-detail-list">{review.map((row,index) => <div className="club-detail-row" key={`${String(row.product_id)}-${String(row.location_id)}-${index}`}><div><strong>{String(row.product ?? "Product")}</strong><span className="muted">{String(row.supplier ?? "Supplier")} · {String(row.supplier_sku ?? "SKU not recorded")} · {String(row.location ?? "Location")}</span></div><span><strong>{String(row.need ?? 0)} needed</strong><small className="muted">{String(row.available ?? 0)} available · minimum {String(row.minimum ?? 0)}</small></span></div>)}</div> : <p className="muted">No products are currently below their replenishment minimum{activeLocation ? ` at ${activeLocation.name}` : ""}.</p>}</Surface>
      {distribution.length ? <Surface><span className="eyebrow">ORDER DESTINATIONS</span>{distribution.map(({batch,rows: items}) => <div className="club-detail-list" key={String(batch.id)}><h2>{String(batch.reference)} · destination plan</h2>{items.map((row,index) => <div className="club-detail-row" key={`${String(row.location_id)}-${String(row.product_id)}-${index}`}><strong>{String(row.location ?? "Location")}</strong><span>{String(row.product ?? "Product")} · {String(row.supplier_sku ?? "SKU")} × {String(row.quantity)}</span></div>)}</div>)}</Surface> : null}
      {demand.length || batches.length ? <ClubSupplierOrders organisationId={context.organisation.id} demand={demand} batches={batches} replenishmentLines={replenishmentLines}/> : <EmptyState title="No supplier demand">Paid available-to-order purchases will appear here when a supplier order is needed.</EmptyState>}
    </>}
    <BackButton href={`/club/shop/supplier-catalogue?org=${encodeURIComponent(context.organisation.id)}`}>Back to supplier catalogue</BackButton><AppNav/></AppShell>;
}
