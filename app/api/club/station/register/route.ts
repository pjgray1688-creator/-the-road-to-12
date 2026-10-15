import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase-server";
import { CLUB_STATION_COOKIE, CLUB_STATION_USER_COOKIE, signClubStationSession, stationSessionTtlSeconds } from "@/lib/club-station";
export async function POST(request: Request) {
  if (!process.env.R12_CLUB_STATION_SESSION_SECRET || Buffer.byteLength(process.env.R12_CLUB_STATION_SESSION_SECRET) < 32) return NextResponse.json({ error: "Shared stations are not configured securely yet." }, { status: 503 });
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in to configure a Club station." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const organisationId = typeof body.organisationId === "string" ? body.organisationId : "";
  const locationId = typeof body.locationId === "string" ? body.locationId : "";
  const stationName = typeof body.stationName === "string" ? body.stationName.trim() : "";
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest();
  const { data, error } = await supabase.rpc("club_register_shared_station", { p_organisation_id: organisationId, p_location_id: locationId, p_station_name: stationName, p_token_hash: `\\x${tokenHash.toString("hex")}` });
  if (error || typeof data !== "string") return NextResponse.json({ error: "This account cannot configure that Club station." }, { status: 403 });
  const response = NextResponse.json({ ok: true, stationName });
  const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge: 60 * 60 * 24 * 365 };
  response.cookies.set(CLUB_STATION_COOKIE, `${data}.${token}`, cookieOptions);
  response.cookies.set(CLUB_STATION_USER_COOKIE, signClubStationSession(user.id, data), { ...cookieOptions, maxAge: stationSessionTtlSeconds() });
  return response;
}
