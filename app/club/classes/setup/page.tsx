import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubClassSetup } from "@/components/club-class-setup";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { ClubSectionNav } from "@/components/club-shell";

export default async function MadhouseClassSetupPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(supabase, user.id, (await searchParams)?.org);
  if (!context || !["gym_admin", "owner"].includes(context.role)) {
    return <AppShell className="module-page club-classes-page"><PageHeader eyebrow="R12 CLUB · CLASSES" title="Operational setup" description="This setup is restricted to Club management."/><EmptyState title="Management access required">Ask an organisation owner to confirm your operational role.</EmptyState><BackButton href="/club/classes">Back to classes</BackButton><AppNav /></AppShell>;
  }
  return <AppShell className="module-page club-classes-page"><PageHeader eyebrow="R12 CLUB · CLASSES" title="Operational setup" description="Prepare future classes, the recurring staff rota and daily checks."/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><ClubClassSetup organisationId={context.organisation.id}/><BackButton href={`/club/classes?org=${encodeURIComponent(context.organisation.id)}`}>Back to classes</BackButton><AppNav /></AppShell>;
}
