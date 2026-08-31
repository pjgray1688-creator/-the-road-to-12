import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { canonicalSessionKey, isImportableWorkout, shouldPreferIncoming } from "../lib/workout-repository";
import { workingWeight } from "../lib/coach";

test("workout persistence migration has owned canonical tables, RLS and grants", () => {
  const sql = fs.readFileSync("supabase/migrations/2026-08-31-workout-persistence.sql", "utf8");
  for (const table of ["workout_sessions", "workout_sets", "workout_cardio", "workout_import_receipts"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`grant select, insert, update, delete on table public\\.${table} to authenticated`));
  }
  assert.match(sql, /unique index if not exists workout_sessions_user_plan_date/);
  assert.match(sql, /with check \(user_id = auth\.uid\(\)\)/);
  assert.match(sql, /create or replace function public\.set_workout_updated_at/);
  assert.match(sql, /workout_sessions_updated_at/);
});

test("canonical identity and import rules are deterministic and non-destructive", () => {
  assert.equal(canonicalSessionKey({ plannedSessionId: "mon", scheduledDate: "2026-08-31" }), "mon:2026-08-31");
  assert.equal(canonicalSessionKey({ plannedSessionId: undefined, scheduledDate: undefined }), null);
  assert.equal(isImportableWorkout({ origin: "real" }), true);
  assert.equal(isImportableWorkout({ origin: "historical" }), true);
  assert.equal(isImportableWorkout({ origin: "test" }), false);
  assert.equal(shouldPreferIncoming(0, 18), true);
  assert.equal(shouldPreferIncoming(18, 0), false);
  assert.equal(shouldPreferIncoming(18, 18), false);
});

test("server workout routes require the authenticated session and never accept an owner id", () => {
  const route = fs.readFileSync("app/api/workouts/route.ts", "utf8");
  const importRoute = fs.readFileSync("app/api/workouts/import/route.ts", "utf8");
  assert.match(route, /authenticatedServerClient/);
  assert.match(route, /Authentication required/);
  assert.doesNotMatch(route, /body\.user_id/);
  assert.match(importRoute, /authenticatedServerClient/);
  assert.doesNotMatch(importRoute, /user_id/);
});

test("canonical session repository preserves preparation and working set distinction", () => {
  const source = fs.readFileSync("lib/workout-repository.ts", "utf8");
  assert.match(source, /kind: set\.kind/);
  assert.match(source, /set\.kind === "working" \? \(set\.rir/);
  assert.match(source, /status: workout\.status/);
  assert.match(source, /version/);
  assert.match(source, /Completed workout cannot be changed/);
  assert.match(source, /already_completed/);
});

test("repository exposes complete-session, set, cardio and import endpoints", () => {
  for (const file of [
    "app/api/workouts/[id]/route.ts",
    "app/api/workouts/[id]/sets/route.ts",
    "app/api/workouts/[id]/cardio/route.ts",
    "app/api/workouts/[id]/complete/route.ts",
    "app/api/workouts/import/route.ts",
  ]) assert.ok(fs.existsSync(file), file);
});

test("Home hydrates server workout state before rendering workout controls", () => {
  const shell = fs.readFileSync("components/home-shell.tsx", "utf8");
  assert.match(shell, /fetchServerWorkouts/);
  assert.match(shell, /importLocalWorkouts/);
  assert.match(shell, /!resolved \|\| !serverResolved/);
  assert.match(shell, /workoutHistory=\{serverWorkouts\}/);
});

test("Training persists the canonical server session, sets, cardio and completion", () => {
  const source = fs.readFileSync("components/training-app.tsx", "utf8");
  assert.match(source, /createOrResumeServerWorkout/);
  assert.match(source, /persistSet/);
  assert.match(source, /persistCardio/);
  assert.match(source, /completeServerWorkout/);
  assert.match(source, /saveWorkout\(updated\)/);
});

test("server workout hydration supports cross-device active and completed sessions", () => {
  const sync = fs.readFileSync("lib/workout-sync.ts", "utf8");
  const shell = fs.readFileSync("components/home-shell.tsx", "utf8");
  assert.match(sync, /fetch\("\/api\/workouts"/);
  assert.match(sync, /\/api\/workouts\/\$\{row\.id\}/);
  assert.match(shell, /item\.status === "active"/);
  assert.match(shell, /selectCompletedWorkout\(workouts/);
});

test("local import is non-destructive and server cache cannot erase richer local data", () => {
  const sync = fs.readFileSync("lib/workout-sync.ts", "utf8");
  assert.match(sync, /cacheServerWorkouts/);
  assert.match(sync, /existing\.sets\.length > server\.sets\.length/);
  assert.match(sync, /road-to-12-data-v1/);
  assert.doesNotMatch(sync, /removeItem\("road-to-12-data-v1"/);
});

test("server round-trip paths are awaited and completion does not clear active state early", () => {
  const training = fs.readFileSync("components/training-app.tsx", "utf8");
  const sync = fs.readFileSync("lib/workout-sync.ts", "utf8");
  assert.match(training, /await persistSet/);
  assert.match(training, /await persistCardio\(workout/);
  assert.match(training, /await completeServerWorkout\(final\)/);
  assert.match(training, /clearActiveWorkout\(\)/);
  assert.match(sync, /responseJson\(await fetch/);
  assert.match(sync, /if \(!detail\.ok\) throw/);
});

test("preparation-only sets never become working-weight history", () => {
  const exercise = { id: "press", name: "Press", target: "3 × 8–10", sets: 3, restSeconds: 120, purpose: "strength" as const, equipment: "dumbbell" as const, defaultWorkingWeight: 40 };
  const rampOnly = [{ id: "r", exerciseId: exercise.id, exerciseName: exercise.name, kind: "ramp" as const, weight: 24, reps: 8, rir: 2, createdAt: "2026-08-31T08:00:00Z" }];
  assert.equal(workingWeight(exercise, rampOnly), 40);
});

test("server round-trip exposes complete sessions and canonical completion", () => {
  const listRoute = fs.readFileSync("app/api/workouts/route.ts", "utf8");
  const detailRoute = fs.readFileSync("app/api/workouts/[id]/route.ts", "utf8");
  const completeRoute = fs.readFileSync("app/api/workouts/[id]/complete/route.ts", "utf8");
  assert.match(listRoute, /listCompleteWorkouts/);
  assert.match(detailRoute, /serverSessionToWorkout/);
  assert.match(completeRoute, /completeWorkout/);
  assert.match(completeRoute, /409/);
});

test("Home uses server canonical state rather than a local active-session shortcut", () => {
  const shell = fs.readFileSync("components/home-shell.tsx", "utf8");
  assert.match(shell, /fetchServerWorkouts/);
  assert.match(shell, /setCompleted\(completedToday\(workouts/);
  assert.match(shell, /setActive\(workouts\.find/);
  assert.doesNotMatch(shell, /loadActiveWorkout/);
});
