import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { serverSupabase } from "@/lib/supabase-server";
import { CLUB_STATION_COOKIE, CLUB_STATION_USER_COOKIE, signClubStationSession, stationCookieValue, stationSessionTtlSeconds } from "@/lib/club-station";
export async function POST(request: NextRequest) {
  const station = stationCookieValue(request.cookies.get(CLUB_STATION_COOKIE)?.value);
  if (!station) return NextResponse.json({ error: "This device is not configured as a Club station." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const userId = typeof body.userId === "string" ? body.userId : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!userId || !/^\d{4,6}$/.test(pin)) return NextResponse.json({ error: "Check the PIN and try again." }, { status: 400 });
  const client = await serverSupabase();
  // A station never layers one staff identity over another session.
  await client.auth.signOut({ scope: "local" });
  try {
    const admin = adminSupabase();
    const verified = await admin.rpc("club_station_verify_pin", { p_station_id: station.id, p_token: station.token, p_user_id: userId, p_pin: pin });
    const email = verified.data && typeof verified.data.email === "string" ? verified.data.email : "";
    if (verified.error || !email) return NextResponse.json({ error: "That PIN could not unlock Club. Check it and try again." }, { status: 401 });
    const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const tokenHash = link.data?.properties?.hashed_token;
    if (link.error || !tokenHash) return NextResponse.json({ error: "Club could not securely start this staff session. Use normal sign-in." }, { status: 503 });
    const auth = await client.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
    if (auth.error || auth.data.user?.id !== userId) return NextResponse.json({ error: "Club could not securely start this staff session. Use normal sign-in." }, { status: 401 });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(CLUB_STATION_USER_COOKIE, signClubStationSession(userId, station.id), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: stationSessionTtlSeconds() });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch { return NextResponse.json({ error: "Club could not securely start this staff session. Use normal sign-in." }, { status: 503 }); }
}
