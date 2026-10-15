import { redirect } from "next/navigation";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubStationAdmin } from "@/components/club-station-admin";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
export const metadata={title:"Shared stations · R12 Club"};
export default async function ClubStationsPage({searchParams}:{searchParams?:Promise<{org?:string}>}){
 const client=await serverSupabase();const {data:{user}}=await client.auth.getUser();if(!user)redirect("/account?mode=signIn&next=%2Fclub%2Fstations");const context=await resolveClubOperationalContext(client,user.id,(await searchParams)?.org);const permitted=context?await context.repository.hasCapability(context.organisation.id,user.id,"staff.permissions_manage"):false;
 if(!context||!permitted)return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · ADMIN" title="Shared stations"/><EmptyState title="Management access required">An organisation manager can register a shared Club station.</EmptyState></AppShell>;
 const locations=await context.repository.listLocations(context.organisation.id);
 return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · ADMIN" title="Shared Club stations" description="Register this browser as a shared staff device."/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><Surface><ClubStationAdmin organisationId={context.organisation.id} locations={locations}/></Surface><Surface><span className="eyebrow">HOW IT WORKS</span><p className="muted">A shared station shows staff first names only. Each person unlocks a fresh R12 session with their own quick PIN. Locking signs that person out and leaves the station registered for the next staff member.</p></Surface></AppShell>;
}
