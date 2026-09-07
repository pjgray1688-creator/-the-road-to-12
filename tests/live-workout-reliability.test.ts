import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { firstIncompleteWorkoutCursor, resolveNextWorkoutAction, resolveWorkoutExercises } from "../lib/workout";

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
  assert.match(source, /resolveNextWorkoutAction/);
  assert.match(source, /set\.kind === "working"/);
  assert.match(source, /setStarted\(true\)/);
});

test("resume skips completed preparation and lands on the first incomplete working set", () => {
  const exercises = [{ id: "row", name: "Row", target: "3 × 8", sets: 3, restSeconds: 90, purpose: "strength" as const, equipment: "barbell" as const, defaultWorkingWeight: 60 }, { id: "pull", name: "Pull-up", target: "3 × 5", sets: 3, restSeconds: 90, purpose: "strength" as const, equipment: "machine" as const, loadingProfile: "bodyweight_assisted" as const, loadUnit: "assistance" as const, defaultWorkingWeight: 0 }];
  const sets = [{ id: "w", exerciseId: "row", exerciseName: "Row", kind: "warmup" as const, weight: 30, reps: 8, createdAt: "now" }, { id: "r1", exerciseId: "row", exerciseName: "Row", kind: "ramp" as const, weight: 45, reps: 5, createdAt: "now" }, { id: "r2", exerciseId: "row", exerciseName: "Row", kind: "ramp" as const, weight: 52.5, reps: 3, createdAt: "now" }, { id: "r3", exerciseId: "row", exerciseName: "Row", kind: "ramp" as const, weight: 57.5, reps: 2, createdAt: "now" }, { id: "1", exerciseId: "row", exerciseName: "Row", kind: "working" as const, weight: 60, reps: 8, rir: 2, createdAt: "now" }, { id: "2", exerciseId: "row", exerciseName: "Row", kind: "working" as const, weight: 60, reps: 8, rir: 2, createdAt: "now" }];
  assert.deepEqual(firstIncompleteWorkoutCursor(exercises, sets), { index: 0, kind: "working", workingCompleted: 2, loggedPreparation: 4 });
});

const row = { id: "row", name: "Row", target: "3 × 8", sets: 3, restSeconds: 90, purpose: "strength" as const, equipment: "barbell" as const, defaultWorkingWeight: 60 };
const logged = (id: string, kind: "warmup" | "ramp" | "working", exerciseId = "row"): import("../lib/types").LoggedSet => ({ id, exerciseId, exerciseName: exerciseId, kind, weight: 40, reps: 5, createdAt: "now", ...(kind === "working" ? { rir: 2 } : {}) });

test("resume resolves each preparation phase instead of replaying it", () => {
  assert.equal(resolveNextWorkoutAction([row], []).kind, "warmup");
  assert.equal(resolveNextWorkoutAction([row], [logged("w", "warmup")]).kind, "ramp");
  assert.equal(resolveNextWorkoutAction([row], [logged("w", "warmup"), logged("r1", "ramp")]).kind, "ramp");
  assert.equal(resolveNextWorkoutAction([row], [logged("w", "warmup"), logged("r1", "ramp"), logged("r2", "ramp"), logged("r3", "ramp")]).kind, "working");
  assert.equal(resolveNextWorkoutAction([row], [logged("one", "working")]).kind, "working");
});

test("resume advances working sets and completed exercises", () => {
  const preparation = [logged("w", "warmup"), logged("r1", "ramp"), logged("r2", "ramp"), logged("r3", "ramp")];
  assert.equal(resolveNextWorkoutAction([row], [...preparation, logged("one", "working")]).workingCompleted, 1);
  const next = { ...row, id: "next" };
  const firstDone = [...preparation, ...["one", "two", "three"].map(id => logged(id, "working"))];
  assert.equal(resolveNextWorkoutAction([row, next], firstDone).index, 1);
});

test("resume resolves completion once every exercise is complete", () => {
  const preparation = [logged("w", "warmup"), logged("r1", "ramp"), logged("r2", "ramp"), logged("r3", "ramp")];
  const sets = [...preparation, ...["one", "two", "three"].map(id => logged(id, "working")), ...preparation.map(item => ({ ...item, exerciseId: "next" })), ...["n1", "n2", "n3"].map(id => logged(id, "working", "next"))];
  assert.equal(resolveNextWorkoutAction([row, { ...row, id: "next" }], sets).kind, "complete");
});

test("unilateral persisted records resume the unfinished side", () => {
  const unilateral = { ...row, id: "cable-lateral-raise", name: "Cable Lateral Raise" };
  const left = (id: string, index: number) => ({ ...logged(id, "working", unilateral.id), exerciseName: `${unilateral.name} — Left`, weight: 9, reps: 12 + index });
  const right = (id: string, index: number) => ({ ...logged(id, "working", unilateral.id), exerciseName: `${unilateral.name} — Right`, weight: 9, reps: 12 + index });
  const sets = [left("l1", 0), right("r1", 0), left("l2", 1), right("r2", 1), left("l3", 2)];
  const cursor = resolveNextWorkoutAction([unilateral], sets);
  assert.equal(cursor.kind, "working");
  assert.equal(cursor.side, "right");
});

test("resume uses the substituted exercise's persisted identity", () => {
  const replacement = { ...row, id: "hack-squat", name: "Hack Squat" };
  const resolved = resolveWorkoutExercises([row], { substitutions: { row: replacement.name }, substitutionDetails: [{ originalExerciseId: "row", replacementExerciseId: "hack-squat", originalExerciseName: row.name, replacementExerciseName: replacement.name, createdAt: "now" }] });
  assert.equal(resolved[0].id, "hack-squat");
  assert.equal(resolveNextWorkoutAction(resolved, [logged("w", "warmup", "hack-squat")]).kind, "ramp");
});

test("empty persisted sets resume at the first action and do not create records", () => {
  const sets: import("../lib/types").LoggedSet[] = [];
  assert.equal(resolveNextWorkoutAction([row], sets).index, 0);
  assert.equal(sets.length, 0);
});
