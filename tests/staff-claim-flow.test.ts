import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { authCallbackUrl, safeInternalReturnTo, staffClaimReturnTo } from "../lib/auth-return";

const read = (path: string) => readFileSync(path, "utf8");
const account = read("app/account/page.tsx");
const verify = read("components/verify-account-client.tsx");
const verifyPage = read("app/account/verify/page.tsx");
const callback = read("components/auth-callback-client.tsx");
const claim = read("app/club/staff/claim/page.tsx");
const memberLink = read("app/member-hub/link/page.tsx");
const claimMigration = read("supabase/migrations/2026-12-27-staff-claim-context.sql");

test("staff claim destination preserves the exact grant through signup and the Supabase confirmation callback", () => {
  const grant = "a1234567-1234-4234-8234-123456789abc";
  const destination = `/club/staff/claim?grant=${grant}`;
  assert.equal(staffClaimReturnTo(grant), destination);
  assert.equal(authCallbackUrl("https://r12.live", destination), `https://r12.live/auth/callback?app=club&next=${encodeURIComponent(destination)}`);
  assert.match(claim, /staffClaimReturnTo\(grantId\)/);
  assert.match(claim, /mode=signIn&next=/);
  assert.match(account, /emailRedirectTo: authCallbackUrl\(appBaseUrl, context\.next, context\.app\)/);
  assert.match(read("app/auth/callback/page.tsx"), /authDestination/);
  assert.match(callback, /window\.location\.replace\(next\)/);
  assert.equal(safeInternalReturnTo("https://evil.example/"), undefined);
});

test("new-account verification is explicit, resend keeps the original safe destination", () => {
  assert.match(account, /router\.replace\(`\/account\/verify\?app=\$\{context\.app\}&next=/);
  assert.match(verify, /Check your email/i);
  assert.match(verify, /Your Club staff access is waiting/);
  assert.match(verify, /auth\.resend\(\{ type: "signup"/);
  assert.match(verify, /authCallbackUrl\(window\.location\.origin, next, app\)/);
  assert.match(verify, /Use a different email/);
  assert.match(verify, /junk or spam/);
  assert.match(verifyPage, /authDestination\(params, true\)/);
});

test("sign-in returns to its requested destination without forcing optional programme onboarding", () => {
  assert.match(account, /else window\.location\.replace\(context\.next\)/);
  assert.doesNotMatch(account, /authMode === "signIn"[^;]*router\.replace\("\/onboarding"\)/);
});

test("staff claim shows verified-email activation and a role-aware success state without member onboarding", () => {
  assert.match(claim, /club_get_my_staff_claim_context/);
  assert.match(claim, /Accept staff access/);
  assert.match(claim, /user\.email_confirmed_at \? <form/);
  assert.match(claim, /Staff access active/);
  assert.match(claim, /Open Club/);
  assert.match(claim, /context\.coach_requested \? <Link className="secondary" href="\/coach">Open Coach/);
  assert.match(claimMigration, /email_normalized=lower\(btrim\(coalesce\(auth\.jwt\(\)->>'email',''\)\)\)/);
  assert.match(claimMigration, /grant_row\.status='accepted' and grant_row\.accepted_by=auth\.uid\(\)/);
  assert.match(claimMigration, /venue_names text\[\]/);
  assert.match(claim, /This invitation may have expired, already been used, or may have been sent to a different email address/);
  assert.doesNotMatch(claim, /onboarding/);
});

test("member activation keeps its member-link return destination and normal signups retain onboarding", () => {
  assert.match(memberLink, /mode=signIn/);
  assert.match(memberLink, /%2Fmember-hub%2Flink/);
  assert.match(account, /authCallbackUrl\(appBaseUrl, context\.next, context\.app\)/);
  assert.match(account, /authDestination\([^;]+mode === "signUp"\)/);
});
