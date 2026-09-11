import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubCatalogue } from "@/components/club-catalogue";
import { ClubSupplierPricing } from "@/components/club-supplier-pricing";
import type { SupplierPricingOffer } from "@/lib/club-supplier-catalogue";
import { ClubProductsPricing } from "@/components/club-products-pricing";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

export default async function ClubProductsPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "commerce.pricing_manage"))) {
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Products & Pricing" /><EmptyState title="Management access required">Product economics and pricing are limited to authorised Club managers.</EmptyState><AppNav /></AppShell>;
  }
  const canManageSupplier = await context.repository.hasCapability(context.organisation.id, user.id, "supplier.catalogue_manage");
  const [products, pricing] = await Promise.all([context.repository.listCommerceProducts(context.organisation.id), canManageSupplier ? client.rpc("club_list_supplier_pricing", { p_organisation_id: context.organisation.id }) : Promise.resolve({ data: [], error: null })]);
  const offers = Array.isArray(pricing.data) ? pricing.data as SupplierPricingOffer[] : [];
  const localProducts = products.filter(product => product.stockTracked || !offers.some(offer => offer.club_product_id === product.id));
  const query = `?org=${encodeURIComponent(context.organisation.id)}`;
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · COMMERCE" title="Products & Pricing" description="The management control centre for retail products, pricing and commercial health." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><ClubProductsPricing products={localProducts} />{canManageSupplier ? pricing.error ? <EmptyState title="Supplier pricing is unavailable">Ask an administrator to check catalogue setup before importing.</EmptyState> : <ClubSupplierPricing organisationId={context.organisation.id} offers={offers} /> : null}<ClubCatalogue organisationId={context.organisation.id} products={localProducts} /><BackButton href={`/club${query}`}>Back to Club</BackButton><AppNav /></AppShell>;
}
