import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { hasPlayReviewerEntitlement } from "../lib/play-reviewer";

test("Play reviewer entitlement is restricted to the confirmed, exact authorised account", () => {
  assert.equal(hasPlayReviewerEntitlement({ email: "staff@r12.live", email_confirmed_at: "2026-01-01T00:00:00Z" }), true);
  assert.equal(hasPlayReviewerEntitlement({ email: " STAFF@R12.LIVE ", email_confirmed_at: "2026-01-01T00:00:00Z" }), true);
  assert.equal(hasPlayReviewerEntitlement({ email: "staff@r12.live", email_confirmed_at: null }), false);
  assert.equal(hasPlayReviewerEntitlement({ email: "other@r12.live", email_confirmed_at: "2026-01-01T00:00:00Z" }), false);
  assert.equal(hasPlayReviewerEntitlement(null), false);
});

test("reviewer receives the production Member Hub component with synthetic data before membership queries", () => {
  const route = readFileSync("app/member-hub/page.tsx", "utf8");
  const hub = readFileSync("components/member-hub.tsx", "utf8");
  const fixtures = readFileSync("lib/play-reviewer-member-data.ts", "utf8");
  assert.match(route, /hasPlayReviewerEntitlement\(user\)\) return <MemberHub data=\{reviewerMemberHubData\(\)\} demoMode \/>/);
  assert.ok(route.indexOf("hasPlayReviewerEntitlement(user)") < route.indexOf('rpc("club_list_my_memberships")'));
  assert.match(hub, /MemberDemoNotice/);
  assert.match(hub, /demoMode\?"Sample · not reserved":"Booked"/);
  assert.match(fixtures, /REVIEWER_ORG_ID/);
  assert.match(fixtures, /reviewerSessions/);
  assert.match(fixtures, /reviewerProducts/);
  assert.doesNotMatch(fixtures, /club_list_my_memberships|club_get_my_access_pass|stripe|customer records/i);
  assert.throws(() => readFileSync("components/play-reviewer-member-hub.tsx", "utf8"));
});

test("reviewer class and shop routes reuse production screens and guard all mutations", () => {
  const classesRoute = readFileSync("app/member-hub/classes/page.tsx", "utf8");
  const classUi = readFileSync("components/club-member-classes.tsx", "utf8");
  const shopRoute = readFileSync("app/member-hub/shop/page.tsx", "utf8");
  const shopUi = readFileSync("components/club-shop.tsx", "utf8");
  assert.match(classesRoute, /<ClubMemberClasses[\s\S]*demoMode\/>/);
  assert.match(classUi, /if \(demoMode\) \{ setMessage\("Demo only: no booking/);
  assert.match(classUi, /Sample booking · not reserved/);
  assert.match(shopRoute, /<ClubShop[\s\S]*demoMode\/>/);
  assert.match(shopUi, /if \(demoMode\) \{ setMessage\("Demo only: no payment was taken and no order was created/);
  assert.match(shopUi, /if \(demoMode\) return;/);
  assert.match(shopUi, /demoMode \? localPricing/);
  assert.equal((classesRoute.match(/className="module-page club-page member-area-page"/g) ?? []).length, 2);
  assert.equal((shopRoute.match(/className="module-page club-page member-area-page member-shop-page"/g) ?? []).length, 2);
  assert.match(readFileSync("components/club-shop.module.css", "utf8"), /@media/);
});

test("reviewer Glow, order, attendance, schedule and membership-link screens do not load or mutate real records", () => {
  const glow = readFileSync("app/member-hub/glow-zone/page.tsx", "utf8");
  const activity = readFileSync("components/glow-zone-activity.tsx", "utf8");
  assert.equal((glow.match(/className="module-page member-area-page glow-zone-page"/g) ?? []).length, 2);
  assert.match(glow, /hasPlayReviewerEntitlement\(user\)\) return/);
  assert.match(glow, /GlowZoneOpeningHours hours=\{reviewerGlowHours\}/);
  assert.match(activity, /if\(demoData\)return/);
  for (const route of ["orders", "attendance", "schedule", "link"]) {
    const page = readFileSync(`app/member-hub/${route}/page.tsx`, "utf8");
    assert.match(page, /hasPlayReviewerEntitlement\(user\)\)\s*return/);
    assert.ok(page.indexOf("hasPlayReviewerEntitlement(user)") < page.indexOf("club_list_my_memberships") || !page.includes("club_list_my_memberships"));
  }
});

test("reviewer access does not create privileged Club roles or weaken training data ownership", () => {
  const source = readFileSync("lib/play-reviewer.ts", "utf8");
  const trainingProfile = readFileSync("app/api/training-profile/route.ts", "utf8");
  const workouts = readFileSync("app/api/workouts/route.ts", "utf8");
  const workoutRepository = readFileSync("lib/workout-repository.ts", "utf8");
  assert.doesNotMatch(source, /gym_staff|coach|owner|admin|club_members|service_role/i);
  assert.match(trainingProfile, /\.eq\("id", user\.id\)/);
  assert.match(workouts, /listCompleteWorkouts\(client, user\.id\)/);
  assert.match(workoutRepository, /\.eq\("user_id", userId\)/);
});
