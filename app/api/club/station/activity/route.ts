import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { serverSupabase } from "@/lib/supabase-server";
import { CLUB_STATION_COOKIE, CLUB_STATION_USER_COOKIE, signClubStationSession, stationCookieValue, stationSessionTtlSeconds, verifyClubStationSession } from "@/lib/club-station";
export async function POST(request:NextRequest){
  const station=stationCookieValue(request.cookies.get(CLUB_STATION_COOKIE)?.value);const session=request.cookies.get(CLUB_STATION_USER_COOKIE)?.value;
  const supabase=await serverSupabase();const {data:{user}}=await supabase.auth.getUser();
  if(!station||!verifyClubStationSession(session,user?.id,station.id))return NextResponse.json({error:"This Club session has expired. Unlock the station again."},{status:401,headers:{"Cache-Control":"private, no-store"}});
  const store=await cookies();store.set(CLUB_STATION_USER_COOKIE,signClubStationSession(user!.id,station.id),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:stationSessionTtlSeconds()});
  return NextResponse.json({ok:true},{headers:{"Cache-Control":"private, no-store"}});
}
