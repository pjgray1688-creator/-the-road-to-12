import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubCashCollections } from "@/components/club-cash-collections";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

type Review = { collections?: Parameters<typeof ClubCashCollections>[0]["collections"]; lateMovements?: Parameters<typeof ClubCashCollections>[0]["lateMovements"] };

export default async function CashCollectionsPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "cash.reconcile"))) return <AppShell className="module-page club-page"><EmptyState title="Cash reconciliation access required">A delegated management capability is required.</EmptyState><AppNav /></AppShell>;
  const [locations, result] = await Promise.all([context.repository.listLocations(context.organisation.id), client.rpc("club_get_cash_collection_review", { p_organisation_id: context.organisation.id })]);
  const review = result.data && typeof result.data === "object" ? result.data as Review : {};
  const query = `?org=${encodeURIComponent(context.organisation.id)}`;
  return <AppShell className="module-page club-page"><PageHeader title="Cash collections" description="Venue-specific locked-box collections and immutable variance review." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />{result.error ? <Surface><EmptyState title="Cash collection workflow is not installed">Apply the reviewed January 27 migration before recording physical collections.</EmptyState></Surface> : <ClubCashCollections organisationId={context.organisation.id} locations={locations.filter(location => location.active).map(location => ({ id: location.id, name: location.name }))} collections={review.collections ?? []} lateMovements={review.lateMovements ?? []} />}<BackButton href={`/club/payments${query}`}>Back to Finance</BackButton><AppNav /></AppShell>;
}
