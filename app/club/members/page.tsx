/* eslint-disable react-hooks/error-boundaries */
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { ClubMembersDirectory } from "@/components/club-members-directory";
import { serverSupabase } from "@/lib/supabase-server";
import { listClubOrganisationContexts, isClubStaffRole } from "@/lib/club-server-context";
import { resolveOrganisationTheme } from "@/lib/club";
import type { ClubMemberSummaryRead } from "@/lib/club-operational";
import { ClubSectionNav } from "@/components/club-shell";

export default async function ClubMembersPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  try {
    const contexts = await listClubOrganisationContexts(supabase, user.id); const orgId = (await searchParams)?.org; const context = orgId ? contexts.find(item => item.organisation.id === orgId) : contexts.length === 1 ? contexts[0] : undefined;
    if (!context || !isClubStaffRole(context.role)) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Members" description="Member directory access is restricted to Club operations staff." /><EmptyState title="Club access required">Choose an authorised organisation or ask an owner to grant operational access.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
    const summaries: ClubMemberSummaryRead[] = await context.repository.listMemberSummaries(context.organisation.id);
    const theme = resolveOrganisationTheme(context.organisation);
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · MEMBERS" title={theme.organisationName} description="Find members and review operational access context." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><ClubMembersDirectory members={summaries} organisationId={context.organisation.id} /><BackButton href={`/club?org=${encodeURIComponent(context.organisation.id)}`}>Back to Club</BackButton><AppNav /></AppShell>;
  } catch { return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Members" description="Member directory." /><EmptyState title="Members couldn’t be loaded.">Try again shortly.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>; }
}
