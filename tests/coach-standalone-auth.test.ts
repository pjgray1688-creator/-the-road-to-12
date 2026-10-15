import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { authCallbackUrl, safeInternalReturnTo } from "../lib/auth-return";
import { isInvalidCredentialsError, isStaleAuthSessionError, isUnverifiedEmailError, signInErrorMessage } from "../lib/auth-sign-in-errors";

const source = (path: string) => readFileSync(path, "utf8");

test("all Coach routes receive a standalone Coach shell and Coach-specific navigation", () => {
  const layout = source("app/coach/layout.tsx");
  const shell = source("components/coach-product-shell.tsx");
  const navigation = source("components/coach-navigation.tsx");
  const workspace = source("components/coach-workspace.tsx");
  const diary = source("app/coach/diary/page.tsx");
  assert.match(layout, /CoachProductShell/);
  for (const route of ["/coach", "/coach/diary", "/coach/programmes", "/coach/nutrition", "/coach/account"]) assert.ok(navigation.includes(`"${route}"`));
  assert.match(shell, /Open R12/);
  assert.match(shell, /href="\/member-hub"/);
  assert.doesNotMatch(workspace, /AppNav|CoachNavigation/);
  assert.doesNotMatch(diary, /AppNav|CoachNavigation/);
  assert.doesNotMatch(source("app/coach/page.tsx"), /AppNav/);
});

test("member app can enter Coach, while Coach keeps a deliberate return to member R12", () => {
  const memberNav = source("components/app-nav.tsx");
  const coachShell = source("components/coach-product-shell.tsx");
  assert.match(memberNav, /href: "\/coach", label: "Coach"/);
  assert.match(memberNav, /api\/coach\/access/);
  assert.match(coachShell, /href="\/member-hub" className=\{styles\.switcher\}/);
});

test("unauthenticated Coach home offers the required sign-in CTA and authorised users get a distinct denial", () => {
  const page = source("app/coach/page.tsx");
  assert.match(page, /SIGN IN TO R12 COACH/);
  assert.match(page, /href="\/account\?next=%2Fcoach"/);
  assert.match(page, /Coach access not enabled/);
  assert.match(page, /This account is not authorised for Coach yet\.|does not currently have Coach access/);
});

test("Coach programme and nutrition navigation reuse authorised client workspaces", () => {
  const programmes = source("app/coach/programmes/page.tsx");
  const nutrition = source("app/coach/nutrition/page.tsx");
  const destinations = source("components/coach-client-destinations.tsx");
  assert.match(programmes, /coach_has_access/);
  assert.match(programmes, /coach_list_clients/);
  assert.match(nutrition, /coach_list_clients/);
  assert.match(destinations, /section=programme/);
  assert.match(destinations, /coach\/nutrition\?client=/);
  assert.match(programmes, /CoachClientDestinations/);
});

test("sign-in errors distinguish credentials, unverified email, stale session, and transient failures", () => {
  const invalid = { code: "invalid_credentials", message: "Invalid login credentials" };
  const unverified = { code: "email_not_confirmed", message: "Email not confirmed" };
  const stale = { code: "PGRST303", message: "JWT issued at future" };
  assert.equal(isInvalidCredentialsError(invalid), true);
  assert.equal(isUnverifiedEmailError(unverified), true);
  assert.equal(isStaleAuthSessionError(stale), true);
  assert.match(signInErrorMessage(invalid), /email and password don’t match/i);
  assert.match(signInErrorMessage(unverified), /verification/i);
  assert.match(signInErrorMessage(stale), /previous sign-in session is no longer valid/i);
  assert.match(signInErrorMessage({ status: 503, message: "upstream unavailable" }), /try again in a moment/i);
  assert.doesNotMatch(signInErrorMessage(stale), /PGRST303|JWT issued at future/i);
});

test("account login preserves the safe Coach return and clears only known-invalid local sessions", () => {
  const account = source("app/account/page.tsx");
  assert.match(account, /safeInternalReturnTo\(new URLSearchParams\(window\.location\.search\)\.get\("next"\)\)/);
  assert.match(account, /signInWithPassword/);
  assert.match(account, /signOut\(\{ scope: "local" \}\)/);
  assert.match(account, /isStaleAuthSessionError/);
  assert.equal(safeInternalReturnTo("/coach"), "/coach");
  assert.equal(safeInternalReturnTo("https://evil.test/coach"), undefined);
  assert.equal(safeInternalReturnTo("//evil.test/coach"), undefined);
  assert.equal(authCallbackUrl("https://r12.live", "/coach"), "https://r12.live/auth/callback?next=%2Fcoach");
});

test("the member shell and Club context remain separate from Coach routes", () => {
  const nav = source("components/app-nav.tsx");
  const clubLayout = source("app/club/layout.tsx");
  assert.match(nav, /Today/);
  assert.match(nav, /if \(pathname\.startsWith\("\/club"\)\) return null/);
  assert.match(clubLayout, /Club/);
  assert.match(source("app/coach/layout.tsx"), /CoachProductShell/);
});

test("Coach account stays inside the Coach shell and provides only shared identity/session actions", () => {
  const route = source("app/coach/account/page.tsx");
  const actions = source("components/coach-account-actions.tsx");
  assert.match(route, /Coach access/);
  assert.match(route, /club_list_my_memberships/);
  assert.match(route, /href="\/member-hub"/);
  assert.match(route, /CoachAccountActions/);
  assert.doesNotMatch(route, /AppNav|member bottom navigation/);
  assert.match(actions, /auth\.signOut\(\{ scope: "local" \}\)/);
  assert.match(source("app/coach/layout.tsx"), /CoachProductShell/);
  assert.match(source("components/coach-navigation.tsx"), /"\/coach\/account"/);
});
