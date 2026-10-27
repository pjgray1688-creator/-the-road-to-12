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

test("Glow native navigation is route scoped and restores each selected tab", () => {
  const configuration = readFileSync("ios/Shared/AppConfiguration.swift", "utf8");
  const nativeShell = readFileSync("ios/Shared/NativeAppShell.swift", "utf8");
  const shell = readFileSync("ios/Shared/RouteWebScreen.swift", "utf8");
  assert.match(configuration, /func allowsEmbeddedNavigation/);
  assert.match(configuration, /sharedAuthPaths/);
  assert.match(configuration, /scheme == "r12-glowzone"/);
  const glowConfiguration = configuration.slice(configuration.indexOf("static let glowZone"));
  assert.doesNotMatch(glowConfiguration, /scope: \{ _ in true \}/);
  assert.match(nativeShell, /activationByDestination/);
  assert.match(nativeShell, /selectDestination/);
  assert.match(shell, /configuration\.allowsEmbeddedNavigation/);
  assert.match(shell, /navigationType == \.linkActivated/);
  assert.match(shell, /configuration\.destination\(for: url\)/);
  assert.match(shell, /lastRequestedURL != url/);
  assert.doesNotMatch(shell, /lastRequestedURL = webView\.url/);
  assert.match(shell, /action\.targetFrame\?\.isMainFrame != false/);
  assert.doesNotMatch(shell, /load\(destinationURL,[^\n]*force: true\)/);
  assert.match(shell, /if !webView\.isLoading/);
  assert.match(configuration, /func destination\(for url: URL\)/);
  assert.match(configuration, /configuredQuery == candidateQuery/);
});

test("Glow redirects do not cause updateUIView to reload the configured tab destination", () => {
  const shell = readFileSync("ios/Shared/RouteWebScreen.swift", "utf8");
  const load = shell.slice(shell.indexOf("func load(_ url:"), shell.indexOf("@objc func refresh"));
  const completion = shell.slice(shell.indexOf("didFinish navigation:"), shell.indexOf("didFailProvisionalNavigation"));
  assert.equal([...shell.matchAll(/context\.coordinator\.load\(url, activation: activation, into: webView\)/g)].length, 2);
  assert.match(load, /lastRequestedURL = url/);
  assert.match(load, /lastActivation != activation/);
  assert.doesNotMatch(completion, /lastRequestedURL|load\(/);
  assert.match(completion, /state\.isLoading = false/);
});

test("password recovery supports click-gated OTP and one-time PKCE on the branded return route", () => {
  const account = readFileSync("app/account/page.tsx", "utf8");
  const reset = readFileSync("components/reset-password-client.tsx", "utf8");
  const resetPage = readFileSync("app/account/reset/page.tsx", "utf8");
  const browserClient = readFileSync("lib/supabase-browser.ts", "utf8");
  const recoveryTemplate = readFileSync("docs/supabase/supabase-reset-password.html", "utf8");
  assert.match(account, /resetParams = new URLSearchParams\(\{ app: context\.app, next: context\.next \}\)/);
  assert.match(reset, /exchangePasswordRecoverySession/);
  assert.match(reset, /verifyPasswordRecoveryToken/);
  assert.match(reset, /Continue to reset password/);
  assert.match(reset, /recoveryAttemptRef/);
  assert.match(reset, /"checking"\|"continue"\|"verifying"\|"ready"\|"invalid"/);
  assert.match(browserClient, /authRedirectSupabase/);
  assert.match(browserClient, /detectSessionInUrl: false/);
  assert.match(browserClient, /isSingleton: false/);
  assert.match(resetPage, /next=\{context\.next\}/);
  assert.match(recoveryTemplate, /\.TokenHash/);
  assert.match(recoveryTemplate, /type=recovery/);
  assert.match(recoveryTemplate, /\.RedirectTo \| urlquery/);
  assert.match(recoveryTemplate, /https:\/\/app\.r12\.live\/account\/reset/);
  assert.doesNotMatch(recoveryTemplate, /\.SiteURL/);
  assert.doesNotMatch(recoveryTemplate, /\.ConfirmationURL/);
});

test("all Glow destinations retain their own setup state instead of redirecting to Home", () => {
  const home = readFileSync("app/glow-zone/page.tsx", "utf8");
  const use = readFileSync("app/glow-zone/use/page.tsx", "utf8");
  const buy = readFileSync("app/glow-zone/buy/page.tsx", "utf8");
  const accountApi = readFileSync("app/api/glow-zone/account/route.ts", "utf8");
  assert.match(home, /GlowZoneCustomerGate current="home"/);
  assert.match(use, /GlowZoneCustomerGate current="use"/);
  assert.match(buy, /GlowZoneCustomerGate current="buy"/);
  assert.doesNotMatch(use, /context\.state!=="ready"\)redirect\("\/glow-zone"\)/);
  assert.doesNotMatch(buy, /context\.state !== "ready"\) redirect\("\/glow-zone"\)/);
  assert.match(accountApi, /customerState: "unlinked"/);
  assert.match(accountApi, /customerState: "unavailable"/);
});

test("verification success requires a confirmed server-authenticated user", () => {
  const callback = readFileSync("components/auth-callback-client.tsx", "utf8");
  const exchange = readFileSync("lib/auth-url-session.ts", "utf8");
  assert.match(callback, /exchangeAuthCodeSession/);
  assert.match(exchange, /client\.auth\.getUser\(\)/);
  assert.match(callback, /email_confirmed_at/);
  assert.doesNotMatch(callback, /onAuthStateChange\(\(_event, session\) => \{ if \(session\?\.user\) finish\(\)/);
});

test("Glow metadata overrides the shared R12 browser identity", () => {
  const layout = readFileSync("app/glow-zone/layout.tsx", "utf8");
  assert.match(layout, /applicationName:"Glow Zone"/);
  assert.match(layout, /glow-zone-icon\.svg/);
  assert.match(layout, /appleWebApp:\{capable:true,statusBarStyle:"black-translucent",title:"Glow Zone"\}/);
});
