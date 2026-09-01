import test from "node:test";
import assert from "node:assert/strict";
import { progressionHistoryForExercise, personalBests } from "../lib/training-history";
import type { Workout } from "../lib/types";

const workout = (id: string, status: Workout["status"], sets: Workout["sets"], extra: Partial<Workout> = {}): Workout => ({ id, name: "Training", startedAt: `${id}-start`, completedAt: status === "completed" ? `${id}-done` : undefined, status, sets, substitutions: {}, notes: [], origin: "real", ...extra });
const set = (kind: "warmup" | "ramp" | "working", exerciseId: string, weight: number, reps: number, rir?: number) => ({ id: `${kind}-${weight}`, exerciseId, exerciseName: exerciseId, weight, reps, rir, kind, createdAt: "now" });

test("progression history contains only completed working sets", () => {
  const workouts = [workout("done", "completed", [set("warmup", "trap-bar-deadlift", 60, 8), set("ramp", "trap-bar-deadlift", 100, 3), set("working", "trap-bar-deadlift", 140, 6, 2)]), workout("active", "active", [set("working", "trap-bar-deadlift", 150, 6, 2)])];
  const history = progressionHistoryForExercise("trap-bar-deadlift", workouts);
  assert.equal(history.length, 1);
  assert.equal(history[0].weight, 140);
  assert.equal(history[0].workoutId, "done");
});

test("substituted performance stays attached to the performed exercise", () => {
  const workouts = [workout("sub", "completed", [set("working", "incline-machine-press", 70, 10, 2)], { substitutions: { "incline-db-press": "Incline Machine Press" } })];
  assert.equal(progressionHistoryForExercise("incline-machine-press", workouts).length, 1);
  assert.equal(progressionHistoryForExercise("incline-db-press", workouts).length, 0);
});

test("discarded or test workouts do not create PBs", () => {
  const candidate = set("working", "trap-bar-deadlift", 160, 5, 2);
  const workouts = [workout("active", "active", [candidate]), workout("test", "completed", [candidate], { origin: "test" })];
  assert.equal(personalBests(workouts).length, 0);
});
