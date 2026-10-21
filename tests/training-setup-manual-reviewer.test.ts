import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createManualProgramme, customExercise } from "../lib/manual-programme";
import { defaultTrainingProfile } from "../lib/training-profile";
import { generateTrainingProgramme } from "../lib/programme-generator";
import { exercisesForSession } from "../lib/workout";
import { searchExercises } from "../lib/exercise-library";

const read = (path: string) => readFileSync(path, "utf8");

test("all four setup choices remain explicit, persistent, and changeable later", () => {
  const choices = read("components/training-setup-choice.tsx");
  const api = read("app/api/training-setup/route.ts");
  for (const label of ["Create my programme with R12", "I’ll build my own programme", "My coach will set my programme", "Skip training setup"]) assert.ok(choices.includes(label));
  for (const value of ['"r12"', '"manual"', '"coach"', '"skip"']) assert.ok(api.includes(value));
  assert.match(choices, /You can change this later/);
  assert.match(read("app/account/page.tsx"), /href="\/onboarding" label="Training setup"/);
  assert.match(api, /\.eq\("id", user\.id\)/);
  assert.doesNotMatch(api, /club_members|membership_status|gym_access|payment/);
});

test("skip preserves membership routes and does not erase profile, plan, or workout history", () => {
  const setup = read("app/api/training-setup/route.ts");
  const account = read("app/account/page.tsx");
  const memberHub = read("app/member-hub/page.tsx");
  assert.match(setup, /\{ \.\.\.profile, _trainingSetupChoice: body\.choice \}/);
  assert.match(account, /href="\/member-hub" label="My Gym"/);
  assert.match(memberHub, /club_list_my_memberships/);
  assert.doesNotMatch(setup, /delete\(|generated_programme:\s*null|workout_sessions/);
});

test("manual programmes use the existing profile programme format and keep custom exercise IDs loggable", () => {
  const custom = customExercise("Landmine Press");
  const session = { id: "manual-day-a", day: 1, name: "Upper", status: "planned" as const, exerciseIds: [custom.id], exerciseOverrides: { [custom.id]: { name: custom.name, sets: 4, target: "6–8", reps: "6–8", load: "RPE 7", restSeconds: 120 } } };
  const programme = createManualProgramme("My own plan", [session], defaultTrainingProfile, "manual-test");
  assert.equal(programme.id, "manual-test");
  assert.equal(programme.framework, "manual");
  const resolved = exercisesForSession(programme.week[0].exerciseIds, programme.week[0].exerciseOverrides);
  assert.equal(resolved[0].id, custom.id);
  assert.equal(resolved[0].name, "Landmine Press");
  assert.equal(resolved[0].sets, 4);
  assert.equal(resolved[0].restSeconds, 120);
  assert.throws(() => createManualProgramme("  ", [session], defaultTrainingProfile));
  assert.match(read("components/manual-programme-editor.tsx"), /Save and activate programme/);
  assert.match(read("components/manual-programme-editor.tsx"), /Add custom exercise/);
  assert.match(read("components/manual-programme-editor.tsx"), /Move earlier/);
});

test("exercise lookup supports search, multiple selected preferences, and removals", () => {
  assert.ok(searchExercises("bulgarian split squat").some(item => item.id === "bulgarian-split-squat"));
  const selector = read("components/exercise-multi-select.tsx");
  const builder = read("app/onboarding/create/page.tsx");
  assert.match(selector, /selected\.includes\(id\) \? selected\.filter/);
  assert.match(selector, /onChange\(selected\.includes\(id\) \?/);
  assert.match(builder, /Exercises I want to include/);
  assert.match(builder, /Exercises I want to avoid/);
});

test("preferred Bulgarian split squat is placed only in a sensible lower day, never every generated session", () => {
  for (const [days, experience] of [[3, "intermediate"], [4, "intermediate"], [5, "experienced"]] as const) {
    const programme = generateTrainingProgramme({ ...defaultTrainingProfile, goal: "muscle_gain", experience, daysPerWeek: days, sessionMinutes: 60, wantedExercises: ["bulgarian-split-squat"], includeCardio: false }, undefined, `bss-${days}`);
    const matching = programme.week.filter(session => session.exerciseIds.includes("bulgarian-split-squat"));
    assert.equal(matching.length, 1, `${programme.framework}: preference should appear once`);
    assert.match(matching[0].name, /Full Body A|Lower Body|Legs/);
    const avoidedPlan = generateTrainingProgramme({ ...defaultTrainingProfile, goal: "muscle_gain", experience, daysPerWeek: days, sessionMinutes: 60, wantedExercises: ["bulgarian-split-squat"], avoidedExercises: ["bulgarian-split-squat"], includeCardio: false }, undefined, `avoid-bss-${days}`);
    assert.ok(avoidedPlan.week.every(session => !session.exerciseIds.includes("bulgarian-split-squat")));
  }
});

test("Coach choice uses the authenticated member plan reader and offers assigned, waiting, and no-coach states", () => {
  const migration = read("supabase/migrations/2027-01-17-member-training-setup-and-coach-plan-read.sql");
  const choice = read("components/training-setup-choice.tsx");
  const api = read("app/api/training-coach-plan/route.ts");
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /member_get_my_coach_plan/);
  assert.match(migration, /status='active'/);
  assert.match(migration, /status='pending'/);
  assert.match(migration, /revoke all .*public,anon/);
  assert.match(api, /rpc\("member_get_my_coach_plan"\)/);
  for (const state of ["assigned", "awaiting", "none"]) assert.ok(choice.includes(`"${state}"`));
  assert.match(choice, /Open Training/);
  assert.match(read("app/api/training-profile/route.ts"), /_programmeSource === "coach"/);
});

test("reviewer navigates the production Member Hub and feature routes with isolated fixtures", () => {
  const route = read("app/member-hub/page.tsx"); const hub = read("components/member-hub.tsx"); const fixture = read("lib/play-reviewer-member-data.ts");
  assert.ok(route.indexOf("hasPlayReviewerEntitlement(user)") < route.indexOf('rpc("club_list_my_memberships")'));
  assert.match(route, /<MemberHub data=\{reviewerMemberHubData\(\)\} demoMode \/>/);
  for (const path of ["/member-hub/classes", "/member-hub/shop", "/member-hub/glow-zone", "/member-hub/schedule", "/member-hub/attendance", "/member-hub/orders"]) assert.ok(hub.includes(path));
  assert.match(hub, /MemberDemoNotice/);
  assert.match(fixture, /active.*true/);
  assert.match(fixture, /reviewerSessions/);
  assert.match(fixture, /reviewerProducts/);
  assert.match(read("app/member-hub/classes/page.tsx"), /<ClubMemberClasses[\s\S]*demoMode\/>/);
  assert.match(read("app/member-hub/shop/page.tsx"), /<ClubShop[\s\S]*demoMode\/>/);
  assert.match(read("app/member-hub/glow-zone/page.tsx"), /GlowZoneOpeningHours hours=\{reviewerGlowHours\}/);
});

test("setup preference and Coach plan migration remain after required schema and do not grant coach writes", () => {
  const manifest = read("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt").trim().split("\n");
  const coachBuilder = manifest.indexOf("supabase/migrations/2026-11-28-coach-programme-builder.sql");
  const newMigration = manifest.indexOf("supabase/migrations/2027-01-17-member-training-setup-and-coach-plan-read.sql");
  assert.ok(coachBuilder >= 0 && newMigration > coachBuilder);
  const migration = read("supabase/migrations/2027-01-17-member-training-setup-and-coach-plan-read.sql");
  assert.match(migration, /grant execute on function public\.member_get_my_coach_plan\(\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute .*coach_(save|activate|create)_programme/);
});
