import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ClubCheckinStation } from "@/components/club-checkin-station";
import { serverSupabase } from "@/lib/supabase-server";
import { CLUB_STATION_COOKIE, CLUB_STATION_USER_COOKIE, stationCookieValue, verifyClubStationSession } from "@/lib/club-station";

export default async function ClubCheckInPage() {
  const client=await serverSupabase();const {data:{user}}=await client.auth.getUser();
  if(!user)redirect("/account?app=club&mode=signIn&next=%2Fclub%2Fcheck-in");
  const jar=await cookies();const station=stationCookieValue(jar.get(CLUB_STATION_COOKIE)?.value);
  if(!station||!verifyClubStationSession(jar.get(CLUB_STATION_USER_COOKIE)?.value,user.id,station.id))redirect("/club/station");
  const {data,error}=await client.rpc("club_shared_station_identity",{p_station_id:station.id,p_station_token:station.token});
  if(error||!data||typeof data.locationName!=="string"||typeof data.stationName!=="string"||typeof data.organisationId!=="string")redirect("/club/station");
  return <ClubCheckinStation locationName={data.locationName} stationName={data.stationName} />;
}
