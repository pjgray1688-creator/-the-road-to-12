/* eslint-disable react-hooks/error-boundaries */
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOperationalContext, isClubStaffRole } from "@/lib/club-server-context";
import { resolveOrganisationTheme } from "@/lib/club";
import { serverSupabase } from "@/lib/supabase-server";
import styles from "@/components/club-operations.module.css";

export default async function ClubLocationsPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  try {
    const context = await resolveClubOperationalContext(client, user.id, (await searchParams)?.org);
    if (!context || !isClubStaffRole(context.role)) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Locations" description="Location management is restricted to Club operations staff." /><EmptyState title="Club access required">Choose an authorised organisation.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
    const locations = await context.repository.listLocations(context.organisation.id);
    const theme = resolveOrganisationTheme(context.organisation);
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · LOCATIONS" title={theme.organisationName} description="Active sites and operational location context." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><Surface>{locations.length ? locations.map(location => <div className="club-detail-row" key={location.id}><div><strong>{location.name}</strong><span className="muted">{location.active ? "Available for operations" : "Inactive location"}</span></div><span className={`${styles.status} ${location.active ? "" : styles.statusMuted}`}>{location.active ? "Active" : "Inactive"}</span></div>) : <EmptyState title="No locations configured">Add a location before scheduling classes or recording site-based sales.</EmptyState>}</Surface><BackButton href={`/club?org=${encodeURIComponent(context.organisation.id)}`}>Back to overview</BackButton><AppNav /></AppShell>;
  } catch { return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Locations" description="Location context." /><EmptyState title="Locations couldn’t be loaded.">Try again shortly.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>; }
}
