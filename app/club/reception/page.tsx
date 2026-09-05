import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubReception } from "@/components/club-reception";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext, isClubStaffRole } from "@/lib/club-server-context";

async function loadReception(client: Awaited<ReturnType<typeof serverSupabase>>, userId: string, organisationId?: string, locationId?: string) {
  const context = await resolveClubOperationalContext(client, userId, organisationId);
  if (!context || !isClubStaffRole(context.role)) return { context: undefined };
  const [members, customers, products, locations, cashDeclarations, canAssign] = await Promise.all([context.repository.listMemberSummaries(context.organisation.id), context.repository.listCustomers(context.organisation.id), context.repository.listProducts(context.organisation.id, true), context.repository.listLocations(context.organisation.id), context.repository.listCashDeclarations(context.organisation.id, "declared"), context.repository.hasCapability(context.organisation.id, userId, "memberships.assign")]);
  return { context, members, customers, products, locations, cashDeclarations, canAssign, locationId: locations.some(location => location.active && location.id === locationId) ? locationId : context.role === "gym_staff" ? locations.find(location => location.active)?.id : undefined };
}

export default async function ClubReceptionPage({ searchParams }: { searchParams?: Promise<{ org?: string; location?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  let loaded;
  try {
    const params = await searchParams;
    loaded = await loadReception(supabase, user.id, params?.org, params?.location);
  } catch (error) {
    const operation = typeof error === "object" && error && "operation" in error ? String(error.operation) : "reception_load";
    if (process.env.NODE_ENV !== "test") console.error("[club-reception] data load failed", { operation });
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Reception" description="The reception workspace is temporarily unavailable." /><EmptyState title="Reception couldn’t be loaded.">Try again shortly. Your organisation and account access have not changed.</EmptyState><AppNav /></AppShell>;
  }
  if (!loaded.context) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Reception" description="Reception access is limited to authorised Club operations staff." /><EmptyState title="Club access required">Choose an organisation where you have an operational role.</EmptyState><AppNav /></AppShell>;
  const { context, members, customers, products, locations, cashDeclarations, canAssign, locationId } = loaded;
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · RECEPTION" title="Reception" description="Find people, record memberships and keep the front desk moving." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} locations={locations} locationId={locationId} /><ClubReception organisationId={context.organisation.id} role={context.role} members={members} customers={customers} products={products} locations={locations} locationId={locationId} cashDeclarations={cashDeclarations} canAssign={canAssign} /><AppNav /></AppShell>;
}
