import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { CLUB_STATION_COOKIE, stationCookieValue } from "@/lib/club-station";
export async function GET(request: NextRequest) {
  const station = stationCookieValue(request.cookies.get(CLUB_STATION_COOKIE)?.value);
  if (!station) return NextResponse.json({ error: "This device is not configured as a Club station." }, { status: 403 });
  try {
    const { data, error } = await adminSupabase().rpc("club_station_list_staff", { p_station_id: station.id, p_token: station.token });
    if (error || !Array.isArray(data)) return NextResponse.json({ error: "This Club station is no longer available." }, { status: 403 });
    return NextResponse.json({ staff: data.map((row: { user_id: string; first_name: string; avatar_url?: string | null }) => ({ id: row.user_id, firstName: row.first_name, ...(row.avatar_url?{photoUrl:row.avatar_url}:{}) })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Staff list is temporarily unavailable." }, { status: 503 }); }
}
