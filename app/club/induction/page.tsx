import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { InductionPolicyForm } from "@/components/club-induction-policy-form";
import { ClubSectionNav } from "@/components/club-shell";
export default async function ClubInductionPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOperationalContext(supabase, user.id, (await searchParams)?.org);
  if (!context || !["gym_admin", "owner"].includes(context.role)) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Induction" description="Induction policy access is restricted." /><EmptyState title="Club access required">Choose an authorised organisation.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · INDUCTION" title="Gym induction" description="Configure the onboarding route members follow before unrestricted access." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><Surface><p className="muted">Induction is an auditable onboarding step. It does not replace the gym’s safety responsibilities.</p><InductionPolicyForm organisationId={context.organisation.id} /></Surface><BackButton href={`/club?org=${encodeURIComponent(context.organisation.id)}`}>Back to Club</BackButton><AppNav /></AppShell>;
}
