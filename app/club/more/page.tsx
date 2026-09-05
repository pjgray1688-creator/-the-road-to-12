import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import Link from "next/link";

export default async function ClubMorePage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  const admin = context && ["gym_admin", "owner"].includes(context.role);
  if (!context || !admin) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="More" /><EmptyState title="Admin access required">Choose an authorised Club organisation.</EmptyState><AppNav /></AppShell>;
  const q = `?org=${encodeURIComponent(context.organisation.id)}`;
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · ADMIN" title="More" description="Lower-frequency Club configuration and administration." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><Surface><div className="section-header"><div><span className="eyebrow">ADMINISTRATION</span><h2>Club settings</h2></div></div><div className="club-profile-grid"><Link className="club-detail-row" href={`/club/locations${q}`}><strong>Locations</strong><span className="muted">Manage venues and operational location settings.</span></Link><Link className="club-detail-row" href={`/club/staff${q}`}><strong>Staff</strong><span className="muted">Manage staff access and Club roles.</span></Link></div></Surface><BackButton href={`/club${q}`}>Back to overview</BackButton><AppNav /></AppShell>;
}
