import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { CLUB_STATION_COOKIE, CLUB_STATION_USER_COOKIE, stationCookieValue } from "@/lib/club-station";

function isSameSiteRecoveryRequest(request: NextRequest) {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  if (site === "cross-site" || (origin && origin !== request.nextUrl.origin)) return false;
  if (referer) {
    try { if (new URL(referer).origin !== request.nextUrl.origin) return false; }
    catch { return false; }
  }
  return true;
}

export async function GET(request: NextRequest) {
  if (!isSameSiteRecoveryRequest(request)) return new NextResponse(null, { status: 403, headers: { "Cache-Control": "private, no-store" } });

  const rawStation = request.cookies.get(CLUB_STATION_COOKIE)?.value;
  const station = stationCookieValue(rawStation);
  let isDisabled = !rawStation || !station;
  if (station) {
    try {
      const tokenHash = `\\x${createHash("sha256").update(station.token).digest("hex")}`;
      const { data, error } = await adminSupabase().from("club_shared_stations").select("enabled").eq("id", station.id).eq("token_hash", tokenHash).maybeSingle();
      if (error) {
        console.warn("[club-station] stale-registration check unavailable", { code: error.code, operation: "station_registration_status" });
        return NextResponse.json({ error: "Station status is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
      }
      isDisabled = !data || data.enabled !== true;
    } catch {
      console.warn("[club-station] stale-registration check failed", { operation: "station_registration_status" });
      return NextResponse.json({ error: "Station status is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
  }

  if (!isDisabled) return NextResponse.redirect(new URL("/club/lock", request.url), 303);
  const response = NextResponse.redirect(new URL("/club", request.url), 303);
  const expiredCookie = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge: 0 };
  response.cookies.set(CLUB_STATION_COOKIE, "", expiredCookie);
  response.cookies.set(CLUB_STATION_USER_COOKIE, "", expiredCookie);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
