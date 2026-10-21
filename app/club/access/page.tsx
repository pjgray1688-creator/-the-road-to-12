import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubAccessConsole } from "@/components/club-access-console";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { GlowZoneOpeningHours } from "@/components/glow-zone-opening-hours";
import type { GlowZoneHourRow } from "@/components/glow-zone-opening-hours";

export default async function ClubAccessPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client=await serverSupabase(); const {data:{user}}=await client.auth.getUser(); if(!user)redirect("/account?mode=signIn");
  const context=await resolveClubOrganisationContext(client,user.id,(await searchParams)?.org);
  if(!context||!(await context.repository.hasCapability(context.organisation.id,user.id,"members.view")))return <AppShell><PageHeader eyebrow="R12 CLUB" title="Door access"/><EmptyState title="Reception access required">You do not have access to member decisions.</EmptyState><AppNav/></AppShell>;
  const [locations,customers,hoursResult]=await Promise.all([context.repository.listLocations(context.organisation.id),context.repository.listCustomers(context.organisation.id),client.from("club_location_service_hours").select("weekday,opens_local,closes_local,confirmation_state,time_zone").eq("organisation_id",context.organisation.id).eq("location_name","Carlton").eq("service_key","sunbeds").order("weekday")]);
  const hours = (hoursResult.data ?? []) as GlowZoneHourRow[];
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · RECEPTION" title="Door access" description="Scan or find a member and get a current, recorded allow or deny decision."/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} locations={locations}/><GlowZoneOpeningHours hours={hours}/><Surface><ClubAccessConsole organisationId={context.organisation.id} locations={locations} customers={customers}/></Surface><AppNav/></AppShell>;
}
