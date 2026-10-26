import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubAccessConsole } from "@/components/club-access-console";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { isClubStaffRole, listClubOrganisationContexts, resolveClubOrganisationContext } from "@/lib/club-server-context";
import { GlowZoneOpeningHours } from "@/components/glow-zone-opening-hours";
import type { GlowZoneHourRow } from "@/components/glow-zone-opening-hours";

export default async function ClubAccessPage({ searchParams }: { searchParams?: Promise<{ org?: string; location?: string }> }) {
  const client=await serverSupabase(); const {data:{user}}=await client.auth.getUser(); if(!user)redirect("/account?app=club&mode=signIn&next=%2Fclub%2Freception");
  const params=await searchParams; const contexts=await listClubOrganisationContexts(client,user.id); const staffContexts=contexts.filter(c=>isClubStaffRole(c.role));
  if (!params?.org && staffContexts.length > 1)return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · RECEPTION" title="Choose your organisation" description="Select the staff workspace for this reception session."/><Surface><div className="quick-grid">{staffContexts.map(c=><Link key={c.organisation.id} href={`/club/reception?org=${encodeURIComponent(c.organisation.id)}`}><strong>{c.organisation.name}</strong><small>{c.role.replaceAll("_"," ")} · Open reception</small></Link>)}</div></Surface><AppNav/></AppShell>;
  const organisationId=params?.org??staffContexts[0]?.organisation.id; const context=organisationId?await resolveClubOrganisationContext(client,user.id,organisationId):undefined;
  if (!context || !isClubStaffRole(context.role) || !(await context.repository.hasCapability(context.organisation.id, user.id, "members.view")))return <AppShell><PageHeader eyebrow="R12 CLUB" title="Door access"/><EmptyState title="Reception access required">You do not have permission to make member access decisions.</EmptyState><AppNav/></AppShell>;
  const [locations,customers,hoursResult]=await Promise.all([context.repository.listLocations(context.organisation.id),context.repository.listCustomers(context.organisation.id),client.from("club_location_service_hours").select("weekday,opens_local,closes_local,confirmation_state,time_zone").eq("organisation_id",context.organisation.id).eq("location_name","Carlton").eq("service_key","sunbeds").order("weekday")]);
  const locationId = locations.some(location => location.active && location.id === params?.location) ? params?.location : undefined; const hours=(hoursResult.data??[]) as GlowZoneHourRow[];
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · RECEPTION" title="Door access" description="Scan or find a member and get a current, recorded allow or deny decision."/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} locations={locations}/><GlowZoneOpeningHours hours={hours}/><Surface><ClubAccessConsole organisationId={context.organisation.id} locations={locations} customers={customers} initialLocationId={locationId}/></Surface><AppNav/></AppShell>;
}
