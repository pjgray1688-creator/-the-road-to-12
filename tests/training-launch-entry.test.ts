import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { trainingProfileForBuilder } from "../lib/onboarding-preferences";
import { generateTrainingProgramme, programmeTrainingDays } from "../lib/programme-generator";
import { defaultTrainingProfile } from "../lib/training-profile";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("fresh accounts and gym-only members can use Home and Gym without starting training setup", () => {
  const root = read("app/page.tsx");
  const home = read("components/home-shell.tsx");
  const account = read("app/account/page.tsx");
  const member = read("app/member-hub/page.tsx");
  assert.doesNotMatch(root, /redirect\("\/onboarding"\)/);
  assert.match(home, /Your account and gym membership remain available without one/);
  assert.match(home, /href="\/onboarding"/);
  assert.doesNotMatch(account, /router\.(push|replace)\("\/onboarding"\)/);
  assert.match(member, /redirect\("\/account\?mode=signIn/);
});

test("existing programme users retain their assigned programme and client data remains user-scoped", () => {
  const boundary = read("components/training-storage-boundary.tsx");
  const page = read("app/training/page.tsx");
  assert.match(boundary, /hasAssignedTrainingProgramme\(profile\)/);
  assert.match(boundary, /activeProgrammeId: profile\.active_programme_id/);
  assert.match(page, /hasAssignedProgramme \? generated/);
  assert.match(read("app/api/training-profile/route.ts"), /\.eq\("id", user\.id\)/);
});

test("account and Member Area are direct destinations while programme setup is explicit", () => {
  const account = read("app/account/page.tsx");
  const member = read("app/member-hub/page.tsx");
  const home = read("components/home-shell.tsx");
  const onboarding = read("app/onboarding/page.tsx");
  assert.match(account, /setAccount\(\{ id: user\.id/);
  assert.match(member, /getUser\(\)/);
  assert.match(home, /href="\/onboarding"/);
  assert.match(onboarding, /Start programme/);
  assert.match(onboarding, /href="\/member-hub"/);
});

test("Home and Back to R12 return to Training, never the Gym Member Area", () => {
  assert.match(read("components/app-nav.tsx"), /href: "\/", label: "Home"/);
  assert.match(read("components/ui.tsx"), /member-hub-page[\s\S]*href=\"\/\"/);
  assert.match(read("app/auth/callback/page.tsx"), /\) \?\? "\/"/);
});

test("flexible availability remains unspecific and duplicate flexible questionnaire answers are removed", () => {
  const choices = read("lib/onboarding-questions.ts");
  assert.equal((choices.match(/flexible_week/g) ?? []).length, 1);
  const profile = { ...defaultTrainingProfile, daysPerWeek: 3 as const, availabilityMode: "flexible_week" as const, availableDays: [2, 4] };
  assert.deepEqual(programmeTrainingDays(profile), [1, 3, 5]);
  assert.deepEqual(generateTrainingProgramme(profile, undefined, "flexible").week.map(item => item.day), [1, 3, 5]);
});

test("explicit fixed days are honoured, saved returning preferences are restored, and switching to flexible clears them", () => {
  const fixed = { ...defaultTrainingProfile, daysPerWeek: 3 as const, availabilityMode: "fixed_days" as const, availableDays: [2, 4, 6] };
  assert.deepEqual(programmeTrainingDays(fixed), [2, 4, 6]);
  assert.deepEqual(generateTrainingProgramme(fixed, undefined, "fixed").week.map(item => item.day), [2, 4, 6]);
  const returning = trainingProfileForBuilder({ trainingProfile: fixed, athleteProfile: undefined, generatedProgramme: undefined });
  assert.deepEqual(returning.availableDays, [2, 4, 6]);
  const changed = { ...fixed, availabilityMode: "flexible_week" as const, availableDays: undefined };
  assert.deepEqual(programmeTrainingDays(changed), [1, 3, 5]);
  const persisted = trainingProfileForBuilder({ ...{ trainingProfile: changed, generatedProgramme: undefined }, athleteProfile: { primaryGoal: "general_fitness", secondaryGoals: [], discipline: "general_fitness", experience: "beginner", training: changed, availability: { mode: "flexible_week", weekdays: [2, 4, 6], sessionsPerWeek: 3 } } });
  assert.equal(persisted.availabilityMode, "flexible_week");
  assert.equal(persisted.availableDays, undefined);
});
