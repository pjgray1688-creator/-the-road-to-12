import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubMenuLinks } from "@/components/club-menu-links";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
export default async function ClubMorePage({ searchParams }: { searchParams?: Promise<{ org?: string; location?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fclub%2Fmore");
  const params = await searchParams;
  const context = await resolveClubOrganisationContext(client, user.id, params?.org);
  if (!context) return <AppShell className="module-page club-page"><PageHeader title="More"/><EmptyState title="Club access required">Choose an authorised Club organisation.</EmptyState><AppNav/></AppShell>;
  return <AppShell className="module-page club-page"><PageHeader title="More" description="Your Club workspace."/>
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/>
    <Surface><ClubMenuLinks role={context.role} organisationId={context.organisation.id} locationId={params?.location}/></Surface>
    <BackButton href={`/club?org=${encodeURIComponent(context.organisation.id)}`}>Back to overview</BackButton><AppNav/>
  </AppShell>;
}
