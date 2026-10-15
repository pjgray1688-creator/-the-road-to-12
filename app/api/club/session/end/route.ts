import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { serverSupabase } from "@/lib/supabase-server";
import { CLUB_STATION_COOKIE, CLUB_STATION_USER_COOKIE, stationCookieValue } from "@/lib/club-station";
export async function POST(request:NextRequest){
  const body=await request.json().catch(()=>({}));const mode=body.mode==="lock"||body.mode==="switch"?body.mode:"signout";
  const store=await cookies();const station=stationCookieValue(request.cookies.get(CLUB_STATION_COOKIE)?.value);const client=await serverSupabase();await client.auth.signOut({scope:"local"});
  store.set(CLUB_STATION_USER_COOKIE,"",{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:0});
  const keepStation=Boolean(station);
  if(!keepStation)store.set(CLUB_STATION_COOKIE,"",{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:0});
  return NextResponse.json({ok:true,locked:Boolean(keepStation&&mode!=="signout")},{headers:{"Cache-Control":"private, no-store"}});
}
