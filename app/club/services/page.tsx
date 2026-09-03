/* eslint-disable react-hooks/error-boundaries */
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext, isClubStaffRole } from "@/lib/club-server-context";
import { resolveOrganisationTheme } from "@/lib/club";

export default async function ClubServicesPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(supabase, user.id, (await searchParams)?.org);
  if (!context || !isClubStaffRole(context.role)) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Services" description="Service operations access is restricted." /><EmptyState title="Club access required">Choose an authorised organisation.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
  try { const services = await context.repository.listServices(context.organisation.id); const locations = await context.repository.listLocations(context.organisation.id); const locationById = new Map(locations.map(location => [location.id, location.name])); const theme = resolveOrganisationTheme(context.organisation); return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · SERVICES" title={theme.organisationName} description="Active venue services and fulfilment context." />{services.length ? <Surface>{services.map(service => <div className="club-detail-row" key={service.id}><div><strong>{service.name}</strong><span className="muted">{service.category} · {service.locationId ? locationById.get(service.locationId) ?? "Location" : "All locations"}</span></div><span className="muted">{service.priceMinor === undefined ? "Non-monetary or rate on request" : `£${(service.priceMinor / 100).toFixed(2)} ${service.currency}`} · {service.active ? "Active" : "Inactive"}</span></div>)}</Surface> : <EmptyState title="No services configured yet">Services such as recovery and other venue offerings will appear here when configured.</EmptyState>}<BackButton href={`/club?org=${encodeURIComponent(context.organisation.id)}`}>Back to Club</BackButton><AppNav /></AppShell>; } catch { return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Services" description="Service operations." /><EmptyState title="Services couldn’t be loaded.">Try again shortly.</EmptyState><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>; }
}
