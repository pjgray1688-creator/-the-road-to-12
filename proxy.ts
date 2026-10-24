import { NextRequest, NextResponse } from "next/server";
import { CLUB_STATION_COOKIE, CLUB_STATION_USER_COOKIE, stationCookieValue, verifyClubStationSession } from "@/lib/club-station";
import { isPublicClubPrivacyRequest, playReviewerClubRequestPolicy } from "@/lib/play-reviewer";

function authClaims(request: NextRequest) {
  const values = request.cookies.getAll();
  const base = values.find(cookie => /^sb-.+-auth-token$/.test(cookie.name));
  const chunks = values.filter(cookie => base ? cookie.name.startsWith(`${base.name}.`) : /^sb-.+-auth-token\.\d+$/.test(cookie.name)).sort((a,b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const raw = base?.value ?? chunks.map(cookie => cookie.value).join("");
  if (!raw) return undefined;
  try {
    const decoded = decodeURIComponent(raw);
    const json = decoded.startsWith("base64-") ? Buffer.from(decoded.slice(7), "base64").toString("utf8") : decoded;
    const accessToken = (JSON.parse(json) as { access_token?: string }).access_token;
    const payload = accessToken?.split(".")[1];
    return payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; email?: string } : undefined;
  } catch { return undefined; }
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (isPublicClubPrivacyRequest(pathname, request.method)) return NextResponse.next();
  const claims = authClaims(request);
  const reviewerPolicy = playReviewerClubRequestPolicy(claims?.email, pathname, request.method);
  if (reviewerPolicy === "deny" && (pathname === "/api/club" || pathname.startsWith("/api/club/"))) {
    return new NextResponse("Club API access is disabled for the read-only review account.", { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
  if (reviewerPolicy === "deny") {
    return new NextResponse("Club changes are disabled for the read-only review account.", { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
  if (reviewerPolicy === "demo") {
    const url = request.nextUrl.clone();
    url.pathname = `/club/reviewer${pathname === "/club" ? "" : pathname.slice("/club".length)}`;
    const response = NextResponse.rewrite(url);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  const station = stationCookieValue(request.cookies.get(CLUB_STATION_COOKIE)?.value);
  if (pathname === "/club/lock") { const headers=new Headers(request.headers);headers.set("x-r12-club-lock-route","1");return NextResponse.next({request:{headers}}); }
  if (!station || !pathname.startsWith("/club") || pathname.startsWith("/api/club/station/")) return NextResponse.next();
  const subject = claims?.sub;
  const stationSession = request.cookies.get(CLUB_STATION_USER_COOKIE)?.value;
  if (verifyClubStationSession(stationSession, subject, station.id)) return NextResponse.next();
  const url = request.nextUrl.clone(); url.pathname = "/club/lock"; url.search = "";
  const response = NextResponse.redirect(url); response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = { matcher: ["/club/:path*", "/api/club/:path*"] };
