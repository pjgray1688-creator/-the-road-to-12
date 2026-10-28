import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { authRequestContext, safeInternalReturnTo } from "../lib/auth-return";

test("auth return paths preserve internal Club URLs and reject open redirects", () => {
  assert.equal(safeInternalReturnTo("/club?org=fa44592a-1593-4ad3-a621-63a4a4bcbceb"), "/club?org=fa44592a-1593-4ad3-a621-63a4a4bcbceb");
  assert.equal(safeInternalReturnTo("/club/shop?org=o&view=stock"), "/club/shop?org=o&view=stock");
  assert.equal(safeInternalReturnTo("https://evil.example/"), undefined);
  assert.equal(safeInternalReturnTo("//evil.example/"), undefined);
  assert.equal(safeInternalReturnTo("javascript:alert(1)"), undefined);
});

test("shared auth preserves exact product return paths for restored sessions", () => {
  for (const [app, next] of [
    ["training", "/training/session?day=2"],
    ["club", "/club/shop?org=club-1&view=stock"],
    ["coach", "/coach/clients?tab=review"],
    ["glow", "/glow-zone/buy?location=carlton"],
  ] as const) {
    assert.deepEqual(authRequestContext({ app, mode: "signIn", next }), { app, next, mode: "signIn", continueAuthenticatedSession: true });
  }
  assert.equal(authRequestContext({ app: "glow", next: "/glow-zone" }).continueAuthenticatedSession, false);
  assert.equal(authRequestContext({ app: "club", mode: "signIn", next: "https://evil.example" }).next, "/club");
  assert.equal(authRequestContext({ app: "club", mode: "signIn", next: "https://evil.example" }).continueAuthenticatedSession, false);
});

test("account sign-in snapshots validated context and performs one full navigation", () => {
  const source = readFileSync("app/account/page.tsx", "utf8");
  assert.match(source, /authRequestRef = useRef<AuthRequestInput>/);
  assert.match(source, /navigationStartedRef\.current/);
  assert.match(source, /continueToAuthDestination\(context\.next\)/);
  assert.match(source, /if \(context\.continueAuthenticatedSession\)/);
  assert.doesNotMatch(source, /const submit = async \(\) => \{[^;]*new URLSearchParams\(window\.location\.search\)/);
});

test("Club and Coach sign-out retain their product authentication context", () => {
  const club = readFileSync("components/club-identity-control.tsx", "utf8");
  const coach = readFileSync("components/coach-account-actions.tsx", "utf8");
  assert.match(club, /app=club&mode=signIn&next=%2Fclub/);
  assert.doesNotMatch(club, /replace\("\/account\?mode=signIn"\)/);
  assert.match(coach, /app=coach&mode=signIn&next=%2Fcoach/);
});
