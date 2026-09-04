import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubCatalogueImport } from "@/components/club-catalogue-import";
import { ClubSupplierCatalogue } from "@/components/club-supplier-catalogue";

export default async function SupplierCataloguePage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "supplier.catalogue_manage"))) return <AppShell className="module-page club-page"><PageHeader eyebrow="SUPPLIER CATALOGUE" title="Supplier catalogue" description="This catalogue is limited to authorised staff." /><EmptyState title="Access required">Ask an owner to grant catalogue access.</EmptyState><AppNav /></AppShell>;
  const [{ data: offersData }, products] = await Promise.all([client.rpc("club_list_supplier_catalogue", { p_organisation_id: context.organisation.id }), context.repository.listCommerceProducts(context.organisation.id)]);
  const offers = Array.isArray(offersData) ? offersData as Array<Record<string, unknown>> : [];
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · CATALOGUE" title="Supplier catalogue" description="Review supplier offers, approve a retail price, and publish selected products to members." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><Surface><ClubCatalogueImport organisationId={context.organisation.id} products={products.map(product => ({ id: product.id, name: product.name }))} /><ClubSupplierCatalogue organisationId={context.organisation.id} offers={offers} products={products} /></Surface><AppNav /></AppShell>;
}
