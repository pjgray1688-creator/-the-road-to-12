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

test("reviewer member hub uses an isolated synthetic view before any real membership lookup", () => {
  const route = readFileSync("app/member-hub/page.tsx", "utf8");
  const demo = readFileSync("components/play-reviewer-member-hub.tsx", "utf8");
  assert.match(route, /hasPlayReviewerEntitlement\(user\)\) return <PlayReviewerMemberHub \/>/);
  assert.ok(route.indexOf("hasPlayReviewerEntitlement(user)") < route.indexOf('rpc("club_list_my_memberships")'));
  assert.match(demo, /DEMO MEMBERSHIP · NO GYM ACCESS/);
  assert.match(demo, /No charges or subscription/);
  assert.match(demo, /no real member/);
  assert.doesNotMatch(demo, /MemberAccessPass|payment_intent|club_get_my_access_pass|stripe/i);
  assert.match(demo, /href="\/history"/);
  assert.match(demo, /href="\/progress"/);
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
