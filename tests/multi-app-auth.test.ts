import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { authAccountHref, resolveAuthApp, returnToForApp } from "../lib/auth-app";
import { authCallbackUrl, authDestination } from "../lib/auth-return";

test("auth context is derived from a validated product destination", () => {
  assert.equal(resolveAuthApp({ app: "training", next: "/glow-zone/buy" }), "glow");
  assert.equal(resolveAuthApp({ app: "club", next: "/coach" }), "coach");
  assert.equal(resolveAuthApp({ app: "glow" }), "glow");
  assert.equal(resolveAuthApp({ app: "invalid" }), "training");
  assert.equal(returnToForApp("glow", "/club", true), "/glow-zone");
});

test("callback and account links preserve app and safe internal continuation", () => {
  assert.equal(authCallbackUrl("https://app.r12.live", "/glow-zone/buy", "glow"), "https://app.r12.live/auth/callback?app=glow&next=%2Fglow-zone%2Fbuy");
  assert.equal(authDestination({ app: "coach", next: "https://evil.test" }, true).next, "/coach");
  assert.equal(authAccountHref("club", "signIn", "/club/reception"), "/account?app=club&mode=signIn&next=%2Fclub%2Freception");
});

test("confirmation is server verified and templates are product branded", () => {
  const route = readFileSync("app/auth/verify/route.ts", "utf8");
  const confirmationPage = readFileSync("app/auth/confirm/page.tsx", "utf8");
  const account = readFileSync("app/account/page.tsx", "utf8");
  const template = readFileSync("docs/supabase/supabase-confirm-signup.html", "utf8");
  assert.match(route, /verifyOtp/);
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET/);
  assert.match(route, /allowedTypes/);
  assert.match(confirmationPage, /action="\/auth\/verify" method="post"/);
  for (const brand of ["Glow Zone", "R12 Club", "R12 Coach", "R12 Training"]) assert.ok(template.includes(brand));
  assert.match(template, /TokenHash/);
  assert.doesNotMatch(template, /R12 × Madhouse/i);
  assert.match(account, /verification === "expired"/);
});

test("Glow Zone setup preserves records and grants no membership or credit", () => {
  const action = readFileSync("app/glow-zone/actions.ts", "utf8");
  const migration = readFileSync("supabase/migrations/2027-01-21-glow-customer-self-registration.sql", "utf8");
  const runner = readFileSync("scripts/apply-madhouse-schema.sh", "utf8");
  assert.match(migration, /email_confirmed_at/);
  assert.match(migration, /lower\(btrim\(email\)\)=v_email/);
  assert.match(migration, /user_id=v_user_id/);
  assert.match(migration, /glow\.customer_(self_linked|created)/);
  assert.doesNotMatch(migration, /insert into public\.(club_members|club_memberships|club_entitlement_grants|club_service_credit)/i);
  assert.match(migration, /from public,anon,authenticated/);
  assert.match(runner, /2027-01-21-glow-customer-self-registration\.sql/);
  assert.match(action, /resolveGlowZoneCustomerContext/);
  assert.doesNotMatch(action, /ensureGlowZoneCustomerAction\(organisationId/);
});

test("native web tabs remember redirects so intended destinations can restore", () => {
  const shell = readFileSync("ios/Shared/RouteWebScreen.swift", "utf8");
  assert.match(shell, /lastURL = webView\.url/);
});
