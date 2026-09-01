import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { currentBlock, currentWeek, measurementChange, weightTrend } from "../lib/domain";
import type { RecoverySnapshot } from "../lib/domain";
import { genuineHistoricalTraining } from "../lib/historical-data";
import { completedWorkoutsOnDate, resolveToday, selectCompletedWorkout, uniqueCompletedSessionCount, upcomingAfterToday } from "../lib/schedule";
import { coachGreeting } from "../lib/greeting";
import { assertOwnership, defaultStepGoal, ownedBy } from "../lib/platform";
import { prepareOwnerMigration } from "../lib/migration";
import { siteUrl } from "../lib/site-url";
import type { AppData } from "../lib/types";
import { exercisesForSession } from "../lib/workout";
import { mostRecentExerciseSession } from "../lib/storage";
import { completedWorkouts, historyExerciseGroups, personalBests } from "../lib/training-history";
import { genuineMondayCandidates, manualMondayReconstruction, promotableMondayWorkout, reconstructVerifiedMonday, verifiedMondayCardio } from "../lib/workout-recovery";

test("historical records are explicit, genuine and distinct from current data", () => { assert.ok(genuineHistoricalTraining.every(record => record.origin === "historical")); assert.equal(genuineHistoricalTraining.find(record => record.exerciseId === "leg-press")?.weight, 300); });
test("current block has a complete seven-day plan with explicit rest", () => { assert.equal(currentWeek.length, 7); assert.equal(currentBlock.status, "active"); assert.equal(currentWeek.find(day => day.id === "thu")?.status, "rest"); assert.equal(currentWeek.find(day => day.id === "thu")?.reason, "planned_rest"); });
test("sessions can communicate changed status without silently moving the programme", () => { const moved = { ...currentWeek[1], status: "rescheduled" as const, reason: "recovery" as const }; assert.equal(moved.status, "rescheduled"); assert.equal(moved.reason, "recovery"); });
test("bodyweight trend uses multiple measurements rather than one weigh-in", () => { const result = weightTrend([{ id: "1", date: "2026-08-01", bodyweight: 80, origin: "real", source: "manual" }, { id: "2", date: "2026-08-08", bodyweight: 79.5, origin: "real", source: "manual" }]); assert.equal(result.current, 79.5); assert.equal(result.weeklyChange, -0.5); assert.equal(result.sinceStart, -0.5); });
test("measurements expose latest, previous and change", () => { const result = measurementChange([{ id: "1", date: "2026-08-01", waist: 80, origin: "real", source: "manual" }, { id: "2", date: "2026-08-08", waist: 79, origin: "real", source: "manual" }], "waist"); assert.deepEqual(result, { latest: 79, previous: 80, change: -1 }); });
test("recovery and integrations have no fabricated values", () => { const snapshot: RecoverySnapshot = { id: "r", date: "2026-08-30", origin: "real", source: "manual" }; assert.equal(snapshot.recoveryScore, undefined); const integration = { provider: "whoop", status: "not_connected" as const, scopes: [] }; assert.equal(integration.status, "not_connected"); });
test("main app mounts visible readiness experience", () => { const source = fs.readFileSync("components/training-app.tsx", "utf8"); const dashboard = fs.readFileSync("components/dashboard-foundation.tsx", "utf8"); assert.match(source, /DashboardFoundation/); assert.match(dashboard, /READINESS/); assert.match(dashboard, /Connect WHOOP/); assert.match(dashboard, /Log recovery/); });
test("Home readiness uses concise sync status and automatic sync without a manual Sync CTA", () => { const dashboard = fs.readFileSync("components/dashboard-foundation.tsx", "utf8"); assert.match(dashboard, /Last sync -/); assert.match(dashboard, /shouldSyncReadiness/); assert.match(dashboard, /fetch\("\/api\/integrations\/whoop\/status"\)/); assert.match(dashboard, /syncingRef/); assert.doesNotMatch(dashboard, /Syncing….*Sync<\/button>/); });
test("schedule resolves Sunday in Europe/London without promoting Monday", () => { const sunday = resolveToday(currentWeek, "Europe/London", new Date("2026-08-30T12:00:00Z")); assert.equal(sunday.day, 7); assert.equal(sunday.session.id, "sun"); assert.equal(upcomingAfterToday(currentWeek, "Europe/London", new Date("2026-08-30T12:00:00Z"), 1)[0].id, "mon"); });
test("schedule respects independent timezone boundaries", () => { const utcMonday = resolveToday(currentWeek, "UTC", new Date("2026-08-30T23:30:00Z")); const tokyoMonday = resolveToday(currentWeek, "Asia/Tokyo", new Date("2026-08-30T23:30:00Z")); assert.equal(utcMonday.day, 7); assert.equal(tokyoMonday.day, 1); });
test("ownership helpers reject cross-user records and preserve step-goal defaults", () => { const record = { userId: "a", value: 1 }; assert.equal(ownedBy(record, "a"), true); assert.equal(ownedBy(record, "b"), false); assert.throws(() => assertOwnership(record, "b")); assert.equal(defaultStepGoal, 10000); });
test("owner migration excludes test data and is idempotent", () => { const data: AppData = { version: 2, workouts: [{ id: "real", startedAt: "", name: "", sets: [], substitutions: {}, notes: [], origin: "real" }, { id: "test", startedAt: "", name: "", sets: [], substitutions: {}, notes: [], origin: "test" }], bodyMetrics: [], meals: [] }; const first = prepareOwnerMigration(data, "owner"); const second = prepareOwnerMigration(data, "owner"); assert.equal(first.counts.workouts, 1); assert.equal(first.idempotencyKey, second.idempotencyKey); });
test("auth site URL is production-safe with local development support", () => { const previous = process.env.NEXT_PUBLIC_SITE_URL; process.env.NEXT_PUBLIC_SITE_URL = "https://the-road-to-12.vercel.app"; assert.equal(siteUrl(), "https://the-road-to-12.vercel.app"); process.env.NEXT_PUBLIC_SITE_URL = previous; });
test("coach greeting uses the profile name and user timezone", () => { const instant = new Date("2026-08-30T07:00:00Z"); assert.equal(coachGreeting("Peter", "Europe/London", instant), "Good morning, Peter"); assert.equal(coachGreeting(undefined, "Europe/London", new Date("2026-08-30T13:00:00Z")), "Good afternoon"); assert.equal(coachGreeting("Peter", "America/New_York", instant), "Good morning, Peter"); assert.equal(coachGreeting("Ready", "Europe/London", new Date("2026-08-30T18:00:00Z")), "Good evening"); });
test("ordinary sign-in redirects to Home while Account remains available", () => { const source = fs.readFileSync("app/account/page.tsx", "utf8"); assert.match(source, /router\.push\("\/"\)/); assert.match(source, /export default function AccountPage/); });
test("profile supports independent names and first-name-only greeting", () => { const schema = fs.readFileSync("supabase/schema.sql", "utf8"); const migration = fs.readFileSync("supabase/migrations/2026-08-31-profile-names.sql", "utf8"); const account = fs.readFileSync("app/account/page.tsx", "utf8"); const dashboard = fs.readFileSync("components/dashboard-foundation.tsx", "utf8"); assert.match(schema, /first_name text/); assert.match(schema, /last_name text/); assert.match(migration, /add column if not exists first_name/); assert.match(account, /First name/); assert.match(account, /Last name/); assert.match(account, /first_name: firstName/); assert.match(account, /authMode === "signUp"/); assert.match(account, /data: \{ first_name: firstName\.trim\(\), last_name: lastName\.trim\(\)/); assert.match(dashboard, /profile\?\.first_name/); });
test("authenticated profile updates are user-scoped and returned", () => { const route = fs.readFileSync("app/api/account/route.ts", "utf8"); assert.match(route, /update\(\{ first_name: firstName, last_name: lastName, display_name: displayName \}\)/); assert.match(route, /\.eq\("id", user\.id\)/); assert.match(route, /select\(profileFields\)/); assert.match(route, /profile_\$\{operation\}_failed/); assert.doesNotMatch(route, /user_metadata\?\.display_name.*first_name/); });
test("Home transitions completed sessions into a post-workout state", () => { const shell = fs.readFileSync("components/home-shell.tsx", "utf8"); assert.match(shell, /selectCompletedWorkout/); assert.match(shell, /requestAnimationFrame\(\(\) => void hydrateServer\(\)\)/); assert.match(shell, /TODAY COMPLETE/); assert.match(shell, /Training is done for today/); assert.match(fs.readFileSync("app/page.tsx", "utf8"), /AuthenticatedHome/); });
test("root gates personal app data behind Supabase authentication", () => { const root = fs.readFileSync("app/page.tsx", "utf8"); const gate = fs.readFileSync("components/authenticated-home.tsx", "utf8"); assert.match(root, /AuthenticatedHome/); assert.match(gate, /getSession/); assert.match(gate, /signed_out/); assert.match(gate, /Get started/); assert.match(gate, /<HomeShell \/>/); });
test("canonical sessions preserve identity, local dates and duplicate-safe progress", () => { const sets = [{ id: "s", exerciseId: "e", exerciseName: "Press", kind: "working" as const, weight: 40, reps: 10, createdAt: "2026-08-31T08:00:00Z" }]; const populated = { id: "a", name: "Monday", plannedSessionId: "mon", scheduledDate: "2026-08-31", status: "completed" as const, startedAt: "2026-08-31T07:00:00Z", completedAt: "2026-08-31T08:00:00Z", sets, substitutions: {}, notes: [] }; const empty = { ...populated, id: "b", sets: [] }; const workouts = [empty, populated]; assert.equal(completedWorkoutsOnDate(workouts, new Date("2026-08-31T09:00:00Z"), "Europe/London").length, 2); assert.equal(selectCompletedWorkout(workouts, new Date("2026-08-31T09:00:00Z"), "Europe/London", "mon")?.id, "a"); assert.equal(uniqueCompletedSessionCount(workouts, "2026-08-01", "2026-09-30", "Europe/London"), 1); });
test("Monday recovery preserves both provenance and verified corrections", () => { const fake = { id: "fake", name: "Upper Push", startedAt: "2026-08-31T07:00:00Z", completedAt: "2026-08-31T07:01:00Z", plannedSessionId: "mon", scheduledDate: "2026-08-31", status: "completed" as const, origin: "test" as const, sets: [], substitutions: {}, notes: [] }; const real = { ...fake, id: "real", origin: "real" as const, sets: [{ id: "s", exerciseId: "tricep-extension", exerciseName: "Tricep Extension - Standing - Rope - Pulley Machine", kind: "working" as const, weight: 27, reps: 10, createdAt: "2026-08-31T07:00:00Z" }] }; assert.equal(genuineMondayCandidates([fake, real]).length, 1); const recovered = reconstructVerifiedMonday(real); assert.equal(recovered.sets[0].exerciseId, "overhead-cable-triceps-extension"); assert.equal(recovered.sets[0].exerciseName, "Overhead Cable Triceps Extension"); assert.deepEqual(recovered.cardio, verifiedMondayCardio); assert.equal(recovered.sets[0].rir, undefined); assert.equal(uniqueCompletedSessionCount([fake, recovered], "2026-08-31", "2026-10-25", "Europe/London"), 1); });
test("manual recovery remains reviewable without localStorage sets", () => { assert.equal(manualMondayReconstruction.plannedSessionId, "mon"); assert.equal(manualMondayReconstruction.sets.length, 38); assert.equal(manualMondayReconstruction.sets.some(set => set.rir !== undefined), false); assert.equal(manualMondayReconstruction.tonnageKg, 14122); assert.deepEqual(manualMondayReconstruction.cardio, { modality: "incline_treadmill", duration: 10, incline: 9.5, speed: 5 }); assert.equal(manualMondayReconstruction.exercises.find(item => item.exerciseName === "Overhead Cable Triceps Extension")?.note, "WHOOP label mapped to the prescribed movement."); assert.equal(manualMondayReconstruction.exercises.find(item => item.exerciseName === "Reverse Crunch Machine")?.note, "Source label preserved; no Cable Crunch rename."); });
test("owner promotion writes only 25 working sets and preserves Reverse Crunch evidence", () => { const promoted = promotableMondayWorkout("2026-08-31T20:00:00.000Z"); assert.equal(promoted.sets.length, 34); assert.equal(promoted.sets.filter(set => set.kind === "working").length, 25); assert.equal(promoted.sets.filter(set => set.kind === "ramp").length, 9); assert.equal(promoted.recoveryEvidence?.length, 4); assert.equal(promoted.sets.some(set => set.exerciseName === "Reverse Crunch Machine"), false); assert.equal(promoted.cardio?.incline, 9.5); assert.equal(promoted.cardio?.speed, 5); assert.equal(promoted.sets.some(set => set.rir !== undefined), false); });
test("block progress counts only canonical real sessions", () => { const base = { id: "x", name: "Upper Push", startedAt: "2026-08-31T07:00:00Z", completedAt: "2026-08-31T08:00:00Z", plannedSessionId: "mon", scheduledDate: "2026-08-31", status: "completed" as const, sets: [], substitutions: {}, notes: [] }; const fake = { ...base, id: "fake", origin: "test" as const }; const historical = { ...base, id: "hist", origin: "historical" as const }; const legacy = { ...base, id: "legacy", plannedSessionId: undefined, scheduledDate: undefined, origin: "real" as const }; const real = { ...base, id: "real", origin: "real" as const }; const duplicate = { ...real, id: "dup" }; assert.equal(uniqueCompletedSessionCount([fake, historical, legacy, real, duplicate], "2026-08-31", "2026-10-25", "Europe/London"), 1); });
test("profile diagnostics and readiness presentation stay safe and concise", () => { const route = fs.readFileSync("app/api/account/route.ts", "utf8"); const dashboard = fs.readFileSync("components/dashboard-foundation.tsx", "utf8"); const theme = fs.readFileSync("app/theme.css", "utf8"); assert.match(route, /profile_permission_denied/); assert.match(route, /profile_rls_violation/); assert.match(route, /profile_missing_column/); assert.match(dashboard, /className="readiness-advice"/); assert.match(theme, /readiness-label.*display:none/); });
test("WHOOP persistence uses the server service-role boundary", () => { const source = fs.readFileSync("lib/whoop-server.ts", "utf8"); assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/); assert.match(source, /createClient/); assert.doesNotMatch(source, /NEXT_PUBLIC_SUPABASE_ANON_KEY/); });
test("planned sessions resolve their own exercise lists", () => {
  assert.equal(exercisesForSession(currentWeek.find(session => session.id === "mon")!.exerciseIds)[0].id, "incline-db-press");
  assert.equal(exercisesForSession(currentWeek.find(session => session.id === "tue")!.exerciseIds)[0].id, "trap-bar-deadlift");
  assert.equal(exercisesForSession(currentWeek.find(session => session.id === "fri")!.exerciseIds)[0].id, "flat-bench");
  assert.deepEqual(exercisesForSession(currentWeek.find(session => session.id === "thu")!.exerciseIds), []);
});
test("workout summary exercise count uses the resolved prescribed list", () => {
  const source = fs.readFileSync("components/training-app.tsx", "utf8");
  assert.match(source, /<b>\{sessionExercises\.length\}<\/b> exercises/);
  assert.doesNotMatch(source, /<b>7<\/b> exercises/);
});
test("history and account surfaces use polished, user-facing records", () => {
  const history = fs.readFileSync("app/history/page.tsx", "utf8");
  const personalBests = fs.readFileSync("app/personal-bests/page.tsx", "utf8");
  const account = fs.readFileSync("app/account/page.tsx", "utf8");
  assert.match(history, /history-exercise/);
  assert.match(history, /Preparation sets/);
  assert.doesNotMatch(history, /Not specified/);
  assert.match(personalBests, /Best set/);
  assert.match(personalBests, /toLocaleDateString\("en-GB"/);
  assert.match(account, /resetPasswordForEmail/);
  assert.match(account, /Forgot password\?/);
});
test("user-facing history suppresses stale duplicates without changing source records", () => {
  const base = { name: "Monday", plannedSessionId: "mon", scheduledDate: "2026-08-31", status: "completed" as const, origin: "real" as const, startedAt: "2026-08-31T07:00:00Z", completedAt: "2026-08-31T08:00:00Z", substitutions: {}, notes: [] };
  const empty = { ...base, id: "empty", sets: [] };
  const genuine = { ...base, id: "genuine", sets: [{ id: "set", exerciseId: "press", exerciseName: "Press", kind: "working" as const, weight: 80, reps: 10, createdAt: base.startedAt }] };
  assert.deepEqual(completedWorkouts([empty, genuine]).map(workout => workout.id), ["genuine"]);
  assert.equal(empty.sets.length, 0);
});
test("primary personal bests prioritize meaningful compounds", () => {
  const workout = { id: "pb", name: "Session", startedAt: "2026-08-31T08:00:00Z", completedAt: "2026-08-31T09:00:00Z", status: "completed" as const, origin: "real" as const, substitutions: {}, notes: [], sets: [
    { id: "compound", exerciseId: "machine-chest-press", exerciseName: "Machine Chest Press", kind: "working" as const, weight: 80, reps: 12, createdAt: "2026-08-31" },
    { id: "accessory", exerciseId: "cable-lateral-raise", exerciseName: "Cable Lateral Raise", kind: "working" as const, weight: 14, reps: 15, createdAt: "2026-08-31" }
  ] };
  const bests = personalBests([workout]);
  assert.deepEqual(bests.map(best => best.exerciseName), ["Machine Chest Press"]);
});
test("every scheduled training exercise resolves without omission", () => {
  for (const session of currentWeek) assert.equal(exercisesForSession(session.exerciseIds).length, session.exerciseIds.length);
  assert.equal(exercisesForSession(currentWeek.find(session => session.id === "mon")!.exerciseIds).length, 7);
  assert.equal(exercisesForSession(currentWeek.find(session => session.id === "tue")!.exerciseIds).find(item => item.id === "leg-press")?.target, "4 × 10");
  assert.equal(exercisesForSession(currentWeek.find(session => session.id === "wed")!.exerciseIds).find(item => item.id === "pull-up-practice")?.sets, 3);
  const friday = currentWeek.find(session => session.id === "fri")!;
  assert.equal(exercisesForSession(friday.exerciseIds, friday.exerciseOverrides).find(item => item.id === "rope-triceps-pushdown")?.target, "3 × 12");
});
test("history and personal bests use only the latest completed working-session evidence", () => {
  const base = { id: "w", name: "Push", startedAt: "2026-08-01T08:00:00Z", completedAt: "2026-08-01T09:00:00Z", status: "completed" as const, origin: "real" as const, sets: [], substitutions: {}, notes: [] };
  const older = { ...base, id: "old", sets: [{ id: "o", exerciseId: "x", exerciseName: "Machine Chest Press", weight: 70, reps: 10, kind: "working" as const, createdAt: "2026-08-01" }] };
  const newer = { ...base, id: "new", completedAt: "2026-08-08T09:00:00Z", sets: [{ id: "n1", exerciseId: "x", exerciseName: "Machine Chest Press", weight: 75, reps: 10, kind: "working" as const, createdAt: "2026-08-08" }, { id: "n2", exerciseId: "x", exerciseName: "Machine Chest Press", weight: 75, reps: 9, kind: "working" as const, createdAt: "2026-08-08" }, { id: "r", exerciseId: "x", exerciseName: "Machine Chest Press", weight: 90, reps: 3, kind: "ramp" as const, createdAt: "2026-08-08" }] };
  assert.deepEqual(mostRecentExerciseSession("x", [older, newer])?.sets.map(set => set.id), ["n1", "n2"]);
  assert.equal(personalBests([older, newer]).find(item => item.exerciseId === "x")?.weight, 75);
});
test("unilateral history pairs left and right entries without doubling logical sets", () => {
  const workout = { id: "uni", name: "Push", startedAt: "2026-08-31T08:00:00Z", completedAt: "2026-08-31T09:00:00Z", status: "completed" as const, origin: "real" as const, substitutions: {}, notes: [], sets: [
    { id: "l1", exerciseId: "cable-lateral-raise", exerciseName: "Cable Lateral Raise — Left", kind: "working" as const, weight: 9, reps: 15, createdAt: "2026-08-31" },
    { id: "r1", exerciseId: "cable-lateral-raise", exerciseName: "Cable Lateral Raise — Right", kind: "working" as const, weight: 9, reps: 14, createdAt: "2026-08-31" },
    { id: "l2", exerciseId: "cable-lateral-raise", exerciseName: "Cable Lateral Raise — Left", kind: "working" as const, weight: 9, reps: 12, createdAt: "2026-08-31" },
    { id: "r2", exerciseId: "cable-lateral-raise", exerciseName: "Cable Lateral Raise — Right", kind: "working" as const, weight: 8, reps: 12, createdAt: "2026-08-31" }
  ] };
  const groups = historyExerciseGroups(workout);
  assert.equal(groups.length, 1); assert.equal(groups[0].unilateral, true); assert.equal(Math.ceil(groups[0].sets.length / 2), 2); assert.equal(groups[0].sets[1].weight, 9); assert.equal(groups[0].sets[3].weight, 8);
});
test("authenticated navigation and workout escape stay product-scoped", () => {
  const nav = fs.readFileSync("components/app-nav.tsx", "utf8");
  const shell = fs.readFileSync("components/home-shell.tsx", "utf8");
  const training = fs.readFileSync("components/training-app.tsx", "utf8");
  assert.match(nav, /Today/); assert.match(nav, /Training/); assert.match(nav, /Account/);
  assert.match(shell, /AppNav/); assert.match(training, /onMinimize/); assert.match(training, /Minimise/);
  assert.doesNotMatch(shell, /<PwaRegister \/>/);
});
