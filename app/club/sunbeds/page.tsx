import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { ClubSunbedOperations } from "@/components/club-sunbed-operations";
import { GlowZoneTopUp } from "@/components/glow-zone-top-up";
export default async function ClubSunbeds({searchParams}:{searchParams?:Promise<{org?:string}>}){const client=await serverSupabase();const{data:{user}}=await client.auth.getUser();if(!user)redirect("/account?mode=signIn");const context=await resolveClubOperationalContext(client,user.id,(await searchParams)?.org);if(!context)return <AppShell><PageHeader title="Sunbeds"/><EmptyState title="Club access required">Choose an authorised Club organisation.</EmptyState><AppNav/></AppShell>;if(!["owner","gym_admin","gym_staff"].includes(context.role))return <AppShell><PageHeader title="Sunbeds"/><EmptyState title="Staff access required">Sunbed operations are limited to Club staff.</EmptyState><AppNav/></AppShell>;const locations=await context.repository.listLocations(context.organisation.id);return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · SERVICES" title="Sunbeds" description="Record staffed GLOW ZONE usage and manage customer minutes."/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><Surface><ClubSunbedOperations organisationId={context.organisation.id} locations={locations}/></Surface><GlowZoneTopUp/><AppNav/></AppShell>}
