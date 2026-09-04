import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";

export default async function SupplierOrdersPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "supplier.orders_manage"))) return <AppShell className="module-page club-page"><PageHeader eyebrow="SUPPLIER ORDERS" title="Supplier orders" description="This operational view is limited to authorised staff." /><EmptyState title="Access required">Ask an owner to grant supplier-order access.</EmptyState><AppNav /></AppShell>;
  const { data } = await client.rpc("club_list_supplier_demand", { p_organisation_id: context.organisation.id }); const demand = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · SUPPLY" title="Supplier orders" description="Paid member demand waiting to be ordered or received." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />{demand.length ? <Surface><div className="club-catalogue-list">{demand.map(item => <article className="club-catalogue-row" key={String(item.id)}><div><strong>{String(item.product)}</strong><small>{item.brand ? `${String(item.brand)} · ` : ""}{item.variant ? `${String(item.variant)} · ` : ""}{item.supplier_sku ? `SKU ${String(item.supplier_sku)}` : "No supplier SKU"}</small></div><span>{String(item.supplier)}</span><span>{String(item.quantity_required)} required · {String(item.quantity_received)} received</span><em>{String(item.status).replaceAll("_", " ")}{item.collection_location ? ` · ${String(item.collection_location)}` : ""}</em></article>)}</div></Surface> : <EmptyState title="No supplier demand">Paid Available-to-Order purchases will appear here once configured.</EmptyState>}<BackButton href={`/club/shop?org=${encodeURIComponent(context.organisation.id)}&view=catalogue`}>Back to catalogue</BackButton><AppNav /></AppShell>;
}
