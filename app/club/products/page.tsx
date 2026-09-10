import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubCatalogue } from "@/components/club-catalogue";
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
  const products = await context.repository.listCommerceProducts(context.organisation.id);
  const query = `?org=${encodeURIComponent(context.organisation.id)}`;
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · COMMERCE" title="Products & Pricing" description="The management control centre for retail products, pricing and commercial health." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><ClubProductsPricing products={products} /><ClubCatalogue organisationId={context.organisation.id} products={products} /><BackButton href={`/club${query}`}>Back to Club</BackButton><AppNav /></AppShell>;
}
