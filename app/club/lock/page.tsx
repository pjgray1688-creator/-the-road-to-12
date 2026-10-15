import Link from "next/link";
import { ClubStationChooser } from "@/components/club-station-lock";
import { serverSupabase } from "@/lib/supabase-server";
import { cookies } from "next/headers";
import { CLUB_STATION_COOKIE, stationCookieValue } from "@/lib/club-station";
export const metadata = { title: "Club Station · R12 Club", robots: { index: false, follow: false } };
export default async function ClubLockPage() {
  const cookieStore=await cookies();const station=stationCookieValue(cookieStore.get(CLUB_STATION_COOKIE)?.value);
  if(station)return <ClubStationChooser/>;
  const supabase=await serverSupabase();const {data:{user}}=await supabase.auth.getUser();
  return <main className="app-shell module-page club-page"><h1>Shared station not configured</h1><p>Sign in with an authorised Club account to set up this device.</p><Link className="primary" href={user?"/club/stations":"/account?mode=signIn&next=%2Fclub%2Fstations"}>{user?"Configure this station":"Sign in to Club"}</Link></main>;
}
