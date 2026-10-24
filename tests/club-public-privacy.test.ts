import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { ClubPrivacyPolicy } from "../components/club-privacy-policy";
import { proxy } from "../proxy";
import { isPublicClubPrivacyRequest, playReviewerClubRequestPolicy } from "../lib/play-reviewer";

// Synthetic local routing input only: never sent to an authentication provider.
const payload = Buffer.from(JSON.stringify({ email: "staff@r12.live", sub: "fixture" })).toString("base64url");
const reviewer = `sb-example-auth-token=${encodeURIComponent(JSON.stringify({ access_token: `fixture.${payload}.fixture` }))}`;
const station = "r12_club_station=fixture.token";
const request = (path: string, cookie = "", method = "GET") => new NextRequest(`https://app.r12.live${path}`, { method, headers: { cookie } });

test("the Club policy is public for anonymous readers, reviewers and locked stations", () => {
  for (const method of ["GET", "HEAD"]) {
    for (const cookie of ["", reviewer, station, `${reviewer}; ${station}`]) {
      const response = proxy(request("/club/privacy", cookie, method));
      assert.equal(response.headers.get("x-middleware-next"), "1");
      assert.equal(response.headers.get("x-middleware-rewrite"), null);
      assert.equal(response.headers.get("location"), null);
    }
    assert.equal(playReviewerClubRequestPolicy("staff@r12.live", "/club/privacy", method), "allow");
  }
});

test("public policy access does not bypass operational locks, reviewer writes or APIs", () => {
  assert.equal(proxy(request("/club/checks", station)).headers.get("location"), "https://app.r12.live/club/lock");
  assert.equal(proxy(request("/club/checks", reviewer)).headers.get("x-middleware-rewrite"), "https://app.r12.live/club/reviewer/checks");
  assert.equal(proxy(request("/api/club/access/decision", reviewer)).status, 403);
  assert.equal(proxy(request("/club/privacy", reviewer, "POST")).status, 403);
  assert.equal(proxy(request("/club/checks", reviewer, "POST")).status, 403);
  for (const path of ["/club/privacy/secret", "/club/privacy-admin", "/api/club/privacy"]) assert.equal(isPublicClubPrivacyRequest(path, "GET"), false);
  assert.equal(isPublicClubPrivacyRequest("/club/privacy", "POST"), false);
});

test("the public Club route does not inherit the operational layout or query account data", () => {
  const page = readFileSync("app/(public-club)/club/privacy/page.tsx", "utf8");
  assert.match(page, /<ClubPrivacyPolicy/);
  assert.match(page, /canonical: "\/club\/privacy"/);
  assert.doesNotMatch(page, /serverSupabase|auth\.|redirect\(/);
  assert.doesNotMatch(readFileSync("components/club-privacy-policy.tsx", "utf8"), /serverSupabase|browserSupabase|fetch\(/);
});

test("rendered Club policy has approved contacts and truthful deletion and processing information", () => {
  const html = renderToStaticMarkup(createElement(ClubPrivacyPolicy));
  assert.match(html, /mailto:peter@r12\.live/);
  for (const href of ["/support", "/account/delete", "/terms", "/privacy"]) assert.ok(html.includes(`href="${href}"`));
  assert.match(html, /does not automatically erase the account/);
  assert.match(html, /one calendar month/);
  assert.match(html, /does not itself cancel a gym membership/);
  assert.match(html, /retention requirements/);
  assert.match(html, /Supabase/);
  assert.match(html, /Vercel/);
  assert.match(html, /WHOOP/);
  assert.match(html, /R12 Digital Ltd/);
  assert.match(html, /participating gym or organisation/);
  assert.doesNotMatch(html, /repository|pending confirmation|placeholder|before publication|no verified public|does not provide an in-app|joint controller|processor agreement|pjgray1688@gmail/i);
});
