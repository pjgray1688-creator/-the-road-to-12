import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { firstIncompleteWorkoutCursor } from "../lib/workout";

test("rest timer recalculates from wall clock when the app returns", () => {
  const source = fs.readFileSync("components/rest-timer.tsx", "utf8");
  assert.match(source, /Date\.now\(\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /window\.addEventListener\("focus"/);
  assert.match(source, /timer-complete/);
  assert.match(source, /AudioContext/);
});

test("active completion notifies the home shell immediately", () => {
  const source = fs.readFileSync("components/training-app.tsx", "utf8");
  assert.match(source, /workout\?\.status === "completed"/);
  assert.match(source, /workouts-updated/);
});

test("resume derives the first incomplete exercise from persisted working sets", () => {
  const source = fs.readFileSync("components/training-app.tsx", "utf8");
  assert.match(source, /firstIncomplete/);
  assert.match(source, /set\.kind === "working"/);
  assert.match(source, /setStarted\(true\)/);
});

test("resume skips completed preparation and lands on the first incomplete working set", () => {
  const exercises = [{ id: "row", name: "Row", target: "3 × 8", sets: 3, restSeconds: 90, purpose: "strength" as const, equipment: "barbell" as const, defaultWorkingWeight: 60 }, { id: "pull", name: "Pull-up", target: "3 × 5", sets: 3, restSeconds: 90, purpose: "strength" as const, equipment: "machine" as const, loadingProfile: "bodyweight_assisted" as const, loadUnit: "assistance" as const, defaultWorkingWeight: 0 }];
  const sets = [{ id: "w", exerciseId: "row", exerciseName: "Row", kind: "warmup" as const, weight: 30, reps: 8, createdAt: "now" }, { id: "r", exerciseId: "row", exerciseName: "Row", kind: "ramp" as const, weight: 45, reps: 5, createdAt: "now" }, { id: "1", exerciseId: "row", exerciseName: "Row", kind: "working" as const, weight: 60, reps: 8, rir: 2, createdAt: "now" }, { id: "2", exerciseId: "row", exerciseName: "Row", kind: "working" as const, weight: 60, reps: 8, rir: 2, createdAt: "now" }];
  assert.deepEqual(firstIncompleteWorkoutCursor(exercises, sets), { index: 0, kind: "working", workingCompleted: 2, loggedPreparation: 2 });
});
