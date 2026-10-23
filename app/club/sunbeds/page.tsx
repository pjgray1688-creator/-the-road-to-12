import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { ClubSunbedOperations } from "@/components/club-sunbed-operations";
import { GlowZoneOpeningHours } from "@/components/glow-zone-opening-hours";
import type { GlowZoneHourRow } from "@/components/glow-zone-opening-hours";

export default async function ClubSunbeds({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOperationalContext(client, user.id, (await searchParams)?.org);
  if (!context) return <AppShell><PageHeader title="Sunbeds"/><EmptyState title="Club access required">Choose an authorised Club organisation.</EmptyState><AppNav/></AppShell>;
  if (!["owner", "gym_admin", "gym_staff"].includes(context.role)) return <AppShell><PageHeader title="Sunbeds"/><EmptyState title="Staff access required">Sunbed operations are limited to Club staff.</EmptyState><AppNav/></AppShell>;
  const [locationsResult, hoursResult] = await Promise.all([context.repository.listLocations(context.organisation.id),client.from("club_location_service_hours").select("weekday,opens_local,closes_local,confirmation_state,time_zone").eq("organisation_id",context.organisation.id).eq("location_name","Carlton").eq("service_key","sunbeds").order("weekday")]);
  const locations = locationsResult; const hours = (hoursResult.data ?? []) as GlowZoneHourRow[];
  return <AppShell className="module-page club-page"><PageHeader title="Glow Zone" description="Find a customer and record sunbed service."/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><Surface><ClubSunbedOperations organisationId={context.organisation.id} locations={locations} canAdjust={context.role === "owner" || context.role === "gym_admin"}/></Surface><GlowZoneOpeningHours hours={hours}/><AppNav/></AppShell>;
}
