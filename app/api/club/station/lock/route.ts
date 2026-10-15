import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { serverSupabase } from "@/lib/supabase-server";
import { CLUB_STATION_USER_COOKIE } from "@/lib/club-station";
export async function POST() {
  const supabase = await serverSupabase(); await supabase.auth.signOut({ scope: "local" });
  const store = await cookies(); store.set(CLUB_STATION_USER_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
}
