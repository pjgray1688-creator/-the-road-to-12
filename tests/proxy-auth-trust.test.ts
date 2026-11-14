import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const proxy = readFileSync("proxy.ts", "utf8");

test("proxy reviewer and station decisions use Supabase-verified identity, never decoded JWT claims", () => {
  assert.match(proxy, /supabase\.auth\.getUser\(\)/);
  assert.match(proxy, /verifiedUser = \{ id: data\.user\.id, email: data\.user\.email \}/);
  assert.match(proxy, /playReviewerClubRequestPolicy\(verifiedUser\?\.email/);
  assert.match(proxy, /playReviewerCoachRequestPolicy\(verifiedUser\?\.email/);
  assert.match(proxy, /verifyClubStationSession\(stationSession, subject, station\.id\)/);
  assert.match(proxy, /const subject = verifiedUser\?\.id/);
  assert.doesNotMatch(proxy, /decodeJwt|decode\(.*base64|JSON\.parse\(Buffer\.from/);
  assert.doesNotMatch(proxy, /claims\?\.(?:sub|email)/);
});

test("proxy avoids verification network calls for routes outside Club/Coach and requests without auth cookies", () => {
  assert.match(proxy, /const needsVerifiedIdentity =/);
  assert.match(proxy, /hasSupabaseAuthCookie\(request\)/);
  assert.match(proxy, /needsVerifiedIdentity && hasSupabaseAuthCookie\(request\)/);
  assert.match(proxy, /pathname !== "\/club\/privacy"/);
  assert.match(proxy, /pathname !== "\/coach\/privacy"/);
  assert.match(proxy, /export const config = \{ matcher: \["\/account\/reset", "\/club\/:path\*", "\/api\/club\/:path\*", "\/coach\/:path\*", "\/api\/coach\/:path\*"\] \}/);
});

test("station cookie verification remains signed, user-bound, station-bound and time-limited", () => {
  const station = readFileSync("lib/club-station.ts", "utf8");
  assert.match(station, /createHmac\("sha256"/);
  assert.match(station, /savedUser !== userId \|\| savedStation !== stationId/);
  assert.match(station, /issuedAt > now \+ 30 \|\| issuedAt < now - maxAgeSeconds/);
  assert.match(station, /timingSafeEqual\(left, right\)/);
});
