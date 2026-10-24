import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasPlayReviewerEntitlement, playReviewerClubRequestPolicy } from "../lib/play-reviewer";
import { reviewerClubMembers, reviewerClubOrganisation, reviewerClubProducts, reviewerClubSessions } from "../lib/play-reviewer-club-data";

const read = (path: string) => readFileSync(path, "utf8");

test("Club review access is limited to the confirmed exact Google Play account", () => {
  assert.equal(hasPlayReviewerEntitlement({ email: "staff@r12.live", email_confirmed_at: "2026-01-01T00:00:00Z" }), true);
  assert.equal(hasPlayReviewerEntitlement({ email: "staff@r12.live" }), false);
  assert.equal(hasPlayReviewerEntitlement({ email: "other@r12.live", email_confirmed_at: "2026-01-01T00:00:00Z" }), false);
  const home = read("app/club/page.tsx");
  assert.match(home, /hasPlayReviewerEntitlement\(user\)\) redirect\("\/club\/reviewer"\)/);
  assert.ok(home.indexOf("hasPlayReviewerEntitlement(user)") < home.indexOf("listClubOrganisationContexts(supabase, user.id)"));
});

test("reviewer Club requests are isolated to synthetic routes and every Club write/API request is blocked", () => {
  assert.equal(playReviewerClubRequestPolicy("staff@r12.live", "/club", "GET"), "demo");
  assert.equal(playReviewerClubRequestPolicy("staff@r12.live", "/club/classes", "POST"), "deny");
  assert.equal(playReviewerClubRequestPolicy("staff@r12.live", "/api/club/access/decision", "POST"), "deny");
  assert.equal(playReviewerClubRequestPolicy("staff@r12.live", "/api/club/access/decision", "GET"), "deny");
  assert.equal(playReviewerClubRequestPolicy("manager@example.test", "/club/classes", "POST"), "allow");
  assert.equal(playReviewerClubRequestPolicy("staff@r12.live", "/account", "POST"), "allow");
  const proxy = read("proxy.ts");
  assert.match(proxy, /playReviewerClubRequestPolicy\(claims\?\.email, pathname, request\.method\)/);
  assert.match(proxy, /reviewerPolicy === "deny"[\s\S]*?pathname === "\/api\/club"/);
  assert.match(proxy, /url\.pathname = `\/club\/reviewer/);
  assert.match(proxy, /matcher: \["\/club\/:path\*", "\/api\/club\/:path\*"\]/);
});

test("reviewer screens authenticate before rendering production Club components with synthetic fixtures", () => {
  const page = read("app/club/reviewer/[[...screen]]/page.tsx");
  assert.ok(page.indexOf("client.auth.getUser()") < page.indexOf("hasPlayReviewerEntitlement(user)"));
  assert.match(page, /ClubSectionNav/);
  assert.match(page, /ClubMembersDirectory/);
  assert.match(page, /ClubClassesWorkspace/);
  assert.match(page, /ClubClassRegister[\s\S]*readOnly/);
  assert.match(page, /ClubChecks[\s\S]*readOnly/);
  assert.match(page, /ClubShop[\s\S]*demoMode/);
  assert.match(page, /GlowZoneOpeningHours/);
  assert.match(page, /DEMO ACCOUNT - READ ONLY/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /No production records were loaded or changed/);
});

test("reviewer data is synthetic and contains no real member emails or production identifiers", () => {
  assert.equal(reviewerClubOrganisation.id, "f0000000-0000-4000-8000-000000000012");
  assert.ok(reviewerClubMembers.every(member => member.email?.endsWith("@example.test")));
  assert.ok(reviewerClubSessions.every(session => session.id.startsWith("f0000000-0000-4000-8000-")));
  assert.ok(reviewerClubProducts.every(product => product.id.startsWith("demo-product-")));
});

test("read-only Club checks and class register render no mutation controls in reviewer mode", () => {
  const checks = read("components/club-checks.tsx");
  const register = read("components/club-class-register.tsx");
  assert.match(checks, /if \(readOnly\) return <>[\s\S]*?return <>/);
  assert.match(register, /!readOnly && canCollectCash/);
  assert.match(register, /!readOnly \? <div className="member-class-action"/);
  assert.match(register, /App Review Demo · synthetic roster · changes are disabled/);
});

test("normal Club staff navigation and permission evaluation are not granted a reviewer role", () => {
  const nav = read("components/club-shell.tsx");
  const permissions = read("lib/club-capabilities.ts");
  assert.match(nav, /roleLabelOverride\?: string/);
  assert.match(nav, /roleLabelOverride \?\? labelRole\(role\)/);
  assert.match(permissions, /export function hasClubCapability/);
  assert.doesNotMatch(permissions, /staff@r12\.live/);
});
