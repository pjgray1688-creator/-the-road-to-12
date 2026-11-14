import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { CLUB_STATION_COOKIE, CLUB_STATION_USER_COOKIE, stationCookieValue, verifyClubStationSession } from "@/lib/club-station";
import { playReviewerClubRequestPolicy, playReviewerCoachRequestPolicy } from "@/lib/play-reviewer";

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies.getAll().some(cookie => /^sb-.+-auth-token(?:\.\d+)?$/.test(cookie.name));
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/account/reset" && request.nextUrl.searchParams.get("type") === "recovery" && request.nextUrl.searchParams.has("token_hash")) {
    const url = request.nextUrl.clone();
    const fragment = new URLSearchParams({ token_hash: url.searchParams.get("token_hash")!, type: "recovery" });
    url.searchParams.delete("token_hash"); url.searchParams.delete("type"); url.hash = fragment.toString();
    const response = NextResponse.redirect(url);
    response.headers.set("Cache-Control", "private, no-store"); response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  let response = NextResponse.next({ request });
  let verifiedUser: { id: string; email?: string | null } | undefined;
  const isClubRequest = pathname.startsWith("/club") || pathname === "/api/club" || pathname.startsWith("/api/club/");
  const isCoachRequest = pathname.startsWith("/coach") || pathname === "/api/coach" || pathname.startsWith("/api/coach/");
  const needsVerifiedIdentity = (isClubRequest && pathname !== "/club/privacy")
    || (isCoachRequest && pathname !== "/coach/privacy");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (needsVerifiedIdentity && hasSupabaseAuthCookie(request) && supabaseUrl && supabaseAnonKey) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: cookiesToSet => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    try {
      const { data, error } = await supabase.auth.getUser();
      if (!error && data.user) verifiedUser = { id: data.user.id, email: data.user.email };
    } catch {
      // Unavailable or invalid sessions are treated as unauthenticated here.
    }
  }

  const finish = (result: NextResponse) => {
    if (result !== response) response.cookies.getAll().forEach(cookie => result.cookies.set(cookie));
    return result;
  };
  const coachReviewerPolicy = playReviewerCoachRequestPolicy(verifiedUser?.email, pathname, request.method);
  if (coachReviewerPolicy === "deny") {
    const denied = new NextResponse("Coach changes and API access are disabled for the read-only review account.", { status: 403, headers: { "Cache-Control": "private, no-store" } });
    return finish(denied);
  }
  const reviewerPolicy = playReviewerClubRequestPolicy(verifiedUser?.email, pathname, request.method);
  if (reviewerPolicy === "deny" && (pathname === "/api/club" || pathname.startsWith("/api/club/"))) {
    const denied = new NextResponse("Club API access is disabled for the read-only review account.", { status: 403, headers: { "Cache-Control": "private, no-store" } });
    return finish(denied);
  }
  if (reviewerPolicy === "deny") {
    const denied = new NextResponse("Club changes are disabled for the read-only review account.", { status: 403, headers: { "Cache-Control": "private, no-store" } });
    return finish(denied);
  }
  if (reviewerPolicy === "demo") {
    const url = request.nextUrl.clone();
    url.pathname = `/club/reviewer${pathname === "/club" ? "" : pathname.slice("/club".length)}`;
    const rewritten = NextResponse.rewrite(url, { request: { headers: request.headers } });
    rewritten.headers.set("Cache-Control", "private, no-store");
    return finish(rewritten);
  }
  const station = stationCookieValue(request.cookies.get(CLUB_STATION_COOKIE)?.value);
  if (pathname === "/club/lock") { const headers=new Headers(request.headers);headers.set("x-r12-club-lock-route","1");return finish(NextResponse.next({request:{headers}})); }
  if (!station || !pathname.startsWith("/club") || pathname.startsWith("/api/club/station/")) return finish(response);
  const subject = verifiedUser?.id;
  const stationSession = request.cookies.get(CLUB_STATION_USER_COOKIE)?.value;
  if (verifyClubStationSession(stationSession, subject, station.id)) return finish(response);
  const url = request.nextUrl.clone(); url.pathname = "/club/lock"; url.search = "";
  const redirected = NextResponse.redirect(url); redirected.headers.set("Cache-Control", "private, no-store");
  return finish(redirected);
}

export const config = { matcher: ["/account/reset", "/club/:path*", "/api/club/:path*", "/coach/:path*", "/api/coach/:path*"] };
