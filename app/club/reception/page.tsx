import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubReception } from "@/components/club-reception";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext, isClubStaffRole } from "@/lib/club-server-context";

export default async function ClubReceptionPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOperationalContext(supabase, user.id, (await searchParams)?.org);
  if (!context || !isClubStaffRole(context.role)) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Reception" description="Reception access is limited to authorised Club operations staff." /><EmptyState title="Club access required">Choose an organisation where you have an operational role.</EmptyState><AppNav /></AppShell>;
  const [members, customers, products, locations, cashDeclarations] = await Promise.all([context.repository.listMemberSummaries(context.organisation.id), context.repository.listCustomers(context.organisation.id), context.repository.listProducts(context.organisation.id, true), context.repository.listLocations(context.organisation.id), context.repository.listCashDeclarations(context.organisation.id, "declared")]);
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · RECEPTION" title="Reception" description="Find people, record memberships and keep the front desk moving." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><ClubReception organisationId={context.organisation.id} role={context.role} members={members} customers={customers} products={products} locations={locations} cashDeclarations={cashDeclarations} /><AppNav /></AppShell>;
}
