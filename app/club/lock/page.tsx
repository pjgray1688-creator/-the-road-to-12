import Link from "next/link";
import { createHash } from "node:crypto";
import { ClubStationChooser } from "@/components/club-station-lock";
import { adminSupabase } from "@/lib/supabase-admin";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { cookies } from "next/headers";
import { CLUB_STATION_COOKIE, stationCookieValue } from "@/lib/club-station";
export const metadata = { title: "Club Station · R12 Club", robots: { index: false, follow: false } };
export default async function ClubLockPage() {
  const cookieStore=await cookies();const station=stationCookieValue(cookieStore.get(CLUB_STATION_COOKIE)?.value);
  const supabase=await serverSupabase();const {data:{user}}=await supabase.auth.getUser();
  if(station){
    let recovery: { organisationId: string } | undefined;
    if(user){
      try{
        const tokenHash=`\\x${createHash("sha256").update(station.token).digest("hex")}`;
        const {data:registered}=await adminSupabase().from("club_shared_stations").select("organisation_id,enabled").eq("id",station.id).eq("token_hash",tokenHash).maybeSingle();
        if(registered?.enabled){
          const roster=await adminSupabase().rpc("club_station_list_staff",{p_station_id:station.id,p_token:station.token});
          const context=await resolveClubOperationalContext(supabase,user.id,registered.organisation_id);
          if(Array.isArray(roster.data)&&roster.data.length===0&&context&&await context.repository.hasCapability(context.organisation.id,user.id,"staff.permissions_manage")) recovery={organisationId:context.organisation.id};
        }
      }catch{/* Keep the station chooser generic when recovery context cannot be verified. */}
    }
    return <ClubStationChooser recovery={recovery}/>;
  }
  return <main className="app-shell module-page club-page"><h1>Shared station not configured</h1><p>Sign in with an authorised Club account to set up this device.</p><Link className="primary" href={user?"/club/stations":"/account?app=club&mode=signIn&next=%2Fclub%2Fstations"}>{user?"Configure this station":"Sign in to Club"}</Link></main>;
}
