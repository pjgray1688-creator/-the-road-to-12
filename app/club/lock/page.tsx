import Link from "next/link";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { ClubStationChooser } from "@/components/club-station-lock";
import { adminSupabase } from "@/lib/supabase-admin";
import { getServerUser } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { cookies } from "next/headers";
import { CLUB_STATION_COOKIE, stationCookieValue } from "@/lib/club-station";
import { safeLoadFailureFields } from "@/lib/club-load-state";
export const metadata = { title: "Club Station · R12 Club", robots: { index: false, follow: false } };
export default async function ClubLockPage() {
  const cookieStore=await cookies();const rawStation=cookieStore.get(CLUB_STATION_COOKIE)?.value;const station=stationCookieValue(rawStation);
  const {client:supabase,user}=await getServerUser();
  if(rawStation&&!station)redirect("/api/club/station/recover");
  if(station){
    let recovery: { organisationId: string } | undefined;
    const tokenHash=`\\x${createHash("sha256").update(station.token).digest("hex")}`;
    let registered: { organisation_id: string; enabled: boolean } | null = null;
    let registrationError: {code?:string}|null=null;
    try{const result=await adminSupabase().from("club_shared_stations").select("organisation_id,enabled").eq("id",station.id).eq("token_hash",tokenHash).maybeSingle();registered=result.data as { organisation_id: string; enabled: boolean } | null;registrationError=result.error;}
    catch(error){registrationError={code:typeof error==="object"&&error&&"code" in error?String(error.code):undefined};}
    if(registrationError)console.warn("[club-station] registration status unavailable",{code:registrationError.code,operation:"station_registration_status"});
    else if(!registered?.enabled)redirect("/api/club/station/recover");
    else if(user){
      try{
        const roster=await adminSupabase().rpc("club_station_list_staff",{p_station_id:station.id,p_token:station.token});
        const context=await resolveClubOperationalContext(supabase,user.id,registered.organisation_id);
        if(Array.isArray(roster.data)&&roster.data.length===0&&context&&await context.repository.hasCapability(context.organisation.id,user.id,"staff.permissions_manage")) recovery={organisationId:context.organisation.id};
      }catch(error){console.warn("[club-station] lock recovery context unavailable",safeLoadFailureFields(error));}
    }
    return <ClubStationChooser recovery={recovery}/>;
  }
  return <main className="app-shell module-page club-page"><h1>Shared station not configured</h1><p>Sign in with an authorised Club account to set up this device.</p><Link className="primary" href={user?"/club/stations":"/account?app=club&mode=signIn&next=%2Fclub%2Fstations"}>{user?"Configure this station":"Sign in to Club"}</Link></main>;
}
