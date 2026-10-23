import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubMembersDirectory } from "@/components/club-members-directory";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext, isClubStaffRole } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

export default async function ClubMembersPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !isClubStaffRole(context.role)) return <AppShell className="module-page club-page"><PageHeader title="Members" /><EmptyState title="Club access required">Member management is available to authorised Club staff.</EmptyState><AppNav /></AppShell>;
  const [members, customers] = await Promise.all([
    context.repository.listMemberSummaries(context.organisation.id),
    context.repository.listCustomers(context.organisation.id),
  ]);
  return <AppShell className="module-page club-page"><PageHeader title="Members" description="Search member accounts and open their existing management profile." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><Surface><ClubMembersDirectory members={members} customers={customers} organisationId={context.organisation.id} /></Surface><AppNav /></AppShell>;
}
