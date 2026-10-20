import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { hasAssignedTrainingProgramme } from "../lib/training-entry";
import { trainingProfileForBuilder } from "../lib/onboarding-preferences";
import { generateTrainingProgramme, programmeTrainingDays } from "../lib/programme-generator";
import { defaultTrainingProfile } from "../lib/training-profile";
import { loadData, saveData, setStorageUserId } from "../lib/storage";
import { homeEntryView } from "../lib/home-entry-state";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("fresh and gym-only accounts stay on Home and get a non-blocking training invitation", () => {
  const root = read("app/page.tsx");
  const home = read("components/home-shell.tsx");
  const training = read("app/training/page.tsx");
  assert.equal(hasAssignedTrainingProgramme({}), false);
  assert.doesNotMatch(root, /onboarding/);
  assert.match(home, /homeEntryView\(hasProgramme/);
  assert.match(home, /Create programme/);
  assert.match(training, /Create my programme/);
  assert.doesNotMatch(training, /legacyProgrammeSnapshot\(data\.trainingProfile\); const week/);
});

test("fresh authenticated Home exits the splash even when workout hydration stalls", () => {
  assert.equal(homeEntryView(false, false), "programme_invitation");
  assert.equal(homeEntryView(false, false, true), "programme_invitation");
  assert.equal(homeEntryView(true, false), "loading");
  assert.equal(homeEntryView(true, false, true), "workouts_unavailable");
  assert.equal(homeEntryView(true, true), "dashboard");
  const home = read("components/home-shell.tsx");
  assert.match(home, /homeEntryView\(hasProgramme, resolved && serverResolved, workoutHydrationFailed\)/);
  assert.match(home, /withTimeout\(fetchServerWorkouts\(\), 12_000\)/);
  assert.match(home, /Try loading your workouts again/);
  const auth = read("components/authenticated-home.tsx");
  assert.match(auth, /setTimeout\(\(\) => \{ if \(alive && !settled\) setState\("error"\); \}, 12_000\)/);
});

test("existing generated and explicitly assigned legacy programmes remain available", () => {
  const generated = { training_profile: { goal: "strength" }, generated_programme: { id: "p-1" }, active_programme_id: "p-1" };
  const legacy = { training_profile: { goal: "strength" }, active_programme_id: "legacy-personal-programme" };
  assert.equal(hasAssignedTrainingProgramme(generated), true);
  assert.equal(hasAssignedTrainingProgramme(legacy), true);
  assert.equal(hasAssignedTrainingProgramme({ ...generated, active_programme_id: "other" }), false);
  assert.match(read("components/training-storage-boundary.tsx"), /activeProgrammeId: profile\.active_programme_id/);
});

test("Account and Gym Member Area do not invoke training onboarding", () => {
  const account = read("app/account/page.tsx");
  const callback = read("app/auth/callback/page.tsx");
  const verify = read("app/account/verify/page.tsx");
  const member = read("app/member-hub/page.tsx");
  assert.doesNotMatch(account, /router\.(push|replace)\("\/onboarding"\)/);
  assert.match(account, /setAccount\(\{ id: user\.id/);
  assert.match(callback, /\) \?\? "\/"/);
  assert.match(verify, /\?\? "\/"/);
  assert.match(member, /getUser\(\)/);
});

test("Home, Back to R12, and auth defaults return to Training Home", () => {
  assert.match(read("components/app-nav.tsx"), /href: "\/", label: "Home"/);
  assert.match(read("components/ui.tsx"), /member-hub-page[\s\S]*href="\/"/);
  assert.match(read("app/account/page.tsx"), /router\.push\(next \?\? "\/"\)/);
  assert.match(read("app/coach/page.tsx"), /href="\/"/);
  assert.match(read("components/coach-product-shell.tsx"), /href="\/"/);
});

test("browser training and active-workout state is isolated by account", () => {
  const originalWindow = globalThis.window;
  const originalStorage = globalThis.localStorage;
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
  try {
    values.set("road-to-12-data-v1", JSON.stringify({ version: 2, workouts: [{ id: "old-shared" }], bodyMetrics: [], meals: [] }));
    setStorageUserId("user-a");
    saveData({ ...loadData(), workouts: [{ id: "a" } as never] });
    setStorageUserId("user-b");
    assert.deepEqual(loadData().workouts, []);
    saveData({ ...loadData(), workouts: [{ id: "b" } as never] });
    assert.ok(values.has("road-to-12-data-v1:user-a"));
    assert.ok(values.has("road-to-12-data-v1:user-b"));
    assert.ok(values.has("road-to-12-data-v1"), "legacy shared cache is preserved but not imported");
  } finally {
    setStorageUserId(null);
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage });
  }
});

test("flexible days do not retain weekday selections; fixed selected days and returning preferences are honoured", () => {
  const flexible = { ...defaultTrainingProfile, daysPerWeek: 3 as const, availabilityMode: "flexible_week" as const, availableDays: [2, 4] };
  assert.equal((read("lib/onboarding-questions.ts").match(/flexible_week/g) ?? []).length, 1);
  assert.deepEqual(programmeTrainingDays(flexible), [1, 3, 5]);
  assert.deepEqual(generateTrainingProgramme(flexible, undefined, "any-days").week.map(session => session.day), [1, 3, 5]);
  const fixed = { ...flexible, availabilityMode: "fixed_days" as const, availableDays: [2, 4, 6] };
  assert.deepEqual(programmeTrainingDays(fixed), [2, 4, 6]);
  assert.deepEqual(generateTrainingProgramme(fixed, undefined, "fixed-days").week.map(session => session.day), [2, 4, 6]);
  const returned = trainingProfileForBuilder({ trainingProfile: fixed, generatedProgramme: undefined, athleteProfile: undefined });
  assert.deepEqual(returned.availableDays, [2, 4, 6]);
  const stale = { ...fixed, availabilityMode: "flexible_week" as const, availableDays: [2, 4, 6] };
  const refreshed = trainingProfileForBuilder({ trainingProfile: stale, generatedProgramme: undefined, athleteProfile: { primaryGoal: "general_fitness", secondaryGoals: [], discipline: "general_fitness", experience: "beginner", training: stale, availability: { mode: "flexible_week", weekdays: [2, 4, 6], sessionsPerWeek: 3 } } });
  assert.equal(refreshed.availableDays, undefined);
  assert.equal(refreshed.availabilityMode, "flexible_week");
});

test("training data pages require a session but never force programme setup", () => {
  assert.match(read("app/training/layout.tsx"), /redirect\(signInDestination\("\/training"\)\)/);
  assert.doesNotMatch(read("app/training/layout.tsx"), /onboarding/);
  assert.match(read("app/onboarding/page.tsx"), /Create a programme|Start programme/);
  assert.match(read("app/onboarding/layout.tsx"), /redirect\(signInDestination\("\/onboarding"\)\)/);
});
