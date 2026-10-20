import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasAssignedTrainingProgramme, signInDestination } from "../lib/training-entry";
import { loadData, saveData, setStorageUserId } from "../lib/storage";

test("fresh accounts without a server-assigned programme stay on home until they choose setup", () => {
  assert.equal(hasAssignedTrainingProgramme(null), false);
  assert.equal(hasAssignedTrainingProgramme({ training_profile: { goal: "general_fitness" } }), false);
  assert.doesNotMatch(readFileSync("app/page.tsx", "utf8"), /redirect\("\/onboarding"\)/);
});

test("existing generated and explicitly legacy training users keep their assigned plan", () => {
  const generated = { training_profile: { goal: "strength" }, generated_programme: { id: "generated-abc" }, active_programme_id: "generated-abc" };
  const legacy = { training_profile: { goal: "strength" }, active_programme_id: "legacy-personal-programme" };
  assert.equal(hasAssignedTrainingProgramme(generated), true);
  assert.equal(hasAssignedTrainingProgramme(legacy), true);
  assert.equal(hasAssignedTrainingProgramme({ ...generated, active_programme_id: "another-user-programme" }), false);
});

test("browser training caches and active state are isolated by authenticated user", () => {
  const values = new Map<string, string>([["road-to-12-data-v1", JSON.stringify({ workouts: [{ id: "legacy-shared" }] })]]);
  const localStorage = {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
  Object.assign(globalThis, { window: {}, localStorage });
  try {
    setStorageUserId("reviewer-a");
    assert.deepEqual(loadData().workouts, []);
    saveData({ ...loadData(), workouts: [{ id: "a-workout" }] } as never);
    setStorageUserId("reviewer-b");
    assert.deepEqual(loadData().workouts, []);
    saveData({ ...loadData(), workouts: [{ id: "b-workout" }] } as never);
    setStorageUserId("reviewer-a");
    assert.deepEqual(loadData().workouts, [{ id: "a-workout" }]);
    assert.deepEqual(JSON.parse(values.get("road-to-12-data-v1")!).workouts, [{ id: "legacy-shared" }]);
  } finally {
    setStorageUserId(null);
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("training pages require authentication while gym Member Area remains a separate route", () => {
  const trainingLayout = readFileSync("app/training/layout.tsx", "utf8");
  const onboardingLayout = readFileSync("app/onboarding/layout.tsx", "utf8");
  const memberHub = readFileSync("app/member-hub/page.tsx", "utf8");
  assert.equal(signInDestination("/training"), "/account?mode=signIn&next=%2Ftraining");
  assert.match(trainingLayout, /if \(!user\) redirect\(signInDestination\("\/training"\)\)/);
  assert.match(onboardingLayout, /if \(!user\) redirect\(signInDestination\("\/onboarding"\)\)/);
  assert.match(memberHub, /if \(!user\) redirect\("\/account\?mode=signIn&next=%2Fmember-hub"\)/);
  assert.match(memberHub, /club_list_my_memberships/);
});

test("training navigation returns to R12 Training, and Member Area stays explicitly accessible", () => {
  const appNav = readFileSync("components/app-nav.tsx", "utf8");
  const shell = readFileSync("components/ui.tsx", "utf8");
  const account = readFileSync("app/account/page.tsx", "utf8");
  const callback = readFileSync("app/auth/callback/page.tsx", "utf8");
  assert.match(appNav, /href: "\/", label: "Home"/);
  assert.match(shell, /member-area-return" href="\/">Back to R12/);
  assert.match(account, /href="\/member-hub" label="My Gym"/);
  assert.match(account, /router\.push\(next \?\? "\/"\)/);
  assert.match(callback, /\?\? "\/"/);
});

test("training profile and workout persistence are filtered to the authenticated identity", () => {
  const profile = readFileSync("app/api/training-profile/route.ts", "utf8");
  const repository = readFileSync("lib/workout-repository.ts", "utf8");
  const workouts = readFileSync("app/api/workouts/route.ts", "utf8");
  assert.match(profile, /\.eq\("id", user\.id\)/);
  assert.match(repository, /\.eq\("user_id", userId\)/);
  assert.match(workouts, /listCompleteWorkouts\(client, user\.id\)/);
});
