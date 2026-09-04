import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubSupplierOrders } from "@/components/club-supplier-orders";

export default async function SupplierOrdersPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "supplier.orders_manage"))) return <AppShell className="module-page club-page"><PageHeader eyebrow="SUPPLIER ORDERS" title="Supplier orders" description="This operational view is limited to authorised staff." /><EmptyState title="Access required">Ask an owner to grant supplier-order access.</EmptyState><AppNav /></AppShell>;
  const [{ data: demandData }, { data: batchData }] = await Promise.all([client.rpc("club_list_supplier_demand", { p_organisation_id: context.organisation.id }), client.rpc("club_list_supplier_order_batches", { p_organisation_id: context.organisation.id })]); const demand = Array.isArray(demandData) ? demandData as Array<Record<string, unknown>> : []; const batches = Array.isArray(batchData) ? batchData as Array<Record<string, unknown>> : [];
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · SUPPLY" title="Supplier orders" description="Consolidate paid member demand, export it, then mark it ordered." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><Surface>{demand.length || batches.length ? <ClubSupplierOrders organisationId={context.organisation.id} demand={demand} batches={batches} /> : <EmptyState title="No supplier demand">Paid Available-to-Order purchases will appear here once configured.</EmptyState>}</Surface><BackButton href={`/club/shop?org=${encodeURIComponent(context.organisation.id)}&view=catalogue`}>Back to catalogue</BackButton><AppNav /></AppShell>;
}
