import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubCollections } from "@/components/club-collections";

export default async function CollectionsPage({ searchParams }: { searchParams?: Promise<{ org?: string; location?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  const params = await searchParams;
  const context = await resolveClubOrganisationContext(client, user.id, params?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "supplier.receive"))) {
    return <AppShell className="module-page club-page"><PageHeader eyebrow="COLLECTIONS" title="Collections" description="This queue is limited to authorised staff." /><EmptyState title="Access required">Ask an owner to grant collection access.</EmptyState><AppNav /></AppShell>;
  }
  const { data } = await client.rpc("club_list_collection_shelf_queue", { p_organisation_id: context.organisation.id, p_location_id: params?.location ?? null });
  const collections = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · FULFILMENT" title="Collection shelf" description="Confirm bagged customer orders are on the shelf. Members collect independently." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} locations={await context.repository.listLocations(context.organisation.id)} locationId={params?.location} /><Surface>{collections.length ? <ClubCollections organisationId={context.organisation.id} collections={collections} locationId={params?.location} /> : <EmptyState title="Nothing ready for the shelf">Customer allocations will appear here after goods are received.</EmptyState>}</Surface><AppNav /></AppShell>;
}
