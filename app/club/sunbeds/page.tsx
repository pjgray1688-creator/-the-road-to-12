import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { ClubSunbedOperations } from "@/components/club-sunbed-operations";
import { GlowZoneOpeningHours } from "@/components/glow-zone-opening-hours";
import type { GlowZoneHourRow } from "@/components/glow-zone-opening-hours";
import { GlowZoneReceptionScanner } from "@/components/glow-zone-reception-scanner";

export default async function ClubSunbeds({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOperationalContext(client, user.id, (await searchParams)?.org);
  if (!context) return <AppShell><PageHeader title="Sunbeds"/><EmptyState title="Club access required">Choose an authorised Club organisation.</EmptyState><AppNav/></AppShell>;
  if (!["owner", "gym_admin", "gym_staff"].includes(context.role)) return <AppShell><PageHeader title="Sunbeds"/><EmptyState title="Staff access required">Sunbed operations are limited to Club staff.</EmptyState><AppNav/></AppShell>;
  const [locationsResult, hoursResult, canManageService, canVerifyAge, canRecordCash, canTakePayment] = await Promise.all([context.repository.listLocations(context.organisation.id),client.from("club_location_service_hours").select("weekday,opens_local,closes_local,confirmation_state,time_zone").eq("organisation_id",context.organisation.id).eq("location_name","Carlton").eq("service_key","sunbeds").order("weekday"),context.repository.hasCapability(context.organisation.id,user.id,"services.manage"),context.repository.hasCapability(context.organisation.id,user.id,"induction.perform"),context.repository.hasCapability(context.organisation.id,user.id,"payments.record_cash"),context.repository.hasCapability(context.organisation.id,user.id,"payments.take")]);
  const locations = locationsResult; const hours = (hoursResult.data ?? []) as GlowZoneHourRow[];
  const carltonLocationId=locations.find(location=>location.name.toLowerCase().includes("carlton"))?.id;
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · SERVICES" title="Sunbeds" description="Approve member requests and manage Carlton Glow Zone minutes."/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><GlowZoneOpeningHours hours={hours}/>{canManageService?<Surface><GlowZoneReceptionScanner organisationId={context.organisation.id} locationId={carltonLocationId} canVerifyAge={canVerifyAge}/></Surface>:null}<Surface><ClubSunbedOperations organisationId={context.organisation.id} locations={locations} canAdjust={context.role === "owner" || context.role === "gym_admin"} canVerifyAge={canVerifyAge} canRecordCash={canRecordCash} canTakePayment={canTakePayment}/></Surface><AppNav/></AppShell>;
}
