import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSet, nextExerciseRecommendation, practicalLoad, startingPrescription } from "../lib/coach";
import type { LoggedSet } from "../lib/types";
import { mondayExercises } from "../lib/workout";

const db = mondayExercises[0]; const machine = mondayExercises[1]; const cable = mondayExercises[3];
const set = (kind: LoggedSet["kind"], weight: number, reps: number, rir: number): LoggedSet => ({ id: crypto.randomUUID(), exerciseId: db.id, exerciseName: db.name, kind, weight, reps, rir, createdAt: new Date().toISOString() });

test("dumbbell loads use realistic 2kg selections", () => { assert.equal(practicalLoad(27.25, "dumbbell"), 28); assert.equal(practicalLoad(41, "dumbbell", undefined, "up"), 42); });
test("machine and cable stacks respect configured increments", () => { assert.equal(practicalLoad(82, "machine", 5), 80); assert.equal(practicalLoad(11.4, "cable", 2.5), 12.5); });
test("starting prescription has a practical warm-up and two ramp loads", () => { assert.deepEqual(startingPrescription(db, []), { warmup: 10, rampOne: 14, rampTwo: 18, work: 20 }); });
test("warm-up transitions to a ramp and is not counted as working", () => { const d = evaluateSet(db, [set("warmup", 10, 12, 4)]); assert.equal(d.nextKind, "ramp"); assert.equal(d.workingSetsCompleted, 0); });
test("two ramp sets establish a working load", () => { const d = evaluateSet(db, [set("warmup", 10, 12, 4), set("ramp", 14, 8, 4), set("ramp", 18, 6, 3)]); assert.equal(d.nextKind, "working"); assert.equal(d.nextWeight, 20); });
test("working sets count independently and complete the exercise", () => { const logged = [set("warmup", 10, 12, 4), set("ramp", 14, 8, 4), set("ramp", 18, 6, 3), set("working", 20, 10, 2), set("working", 20, 9, 1), set("working", 20, 8, 1), set("working", 20, 8, 1)]; const d = evaluateSet(db, logged); assert.equal(d.completed, true); assert.equal(d.workingSetsCompleted, 4); });
test("top range at appropriate RIR keeps the load", () => { const d = evaluateSet(machine, [{ ...set("working", 80, 12, 2), exerciseId: machine.id }]); assert.equal(d.nextWeight, 80); assert.equal(d.tone, "hold"); });
test("very easy top-range work gets one realistic increment", () => { const d = evaluateSet(machine, [{ ...set("working", 80, 12, 4), exerciseId: machine.id }]); assert.equal(d.nextWeight, 85); assert.equal(d.tone, "progress"); });
test("fatigue after multiple working sets reduces a practical increment", () => { const d = evaluateSet(db, [set("working", 20, 10, 2), set("working", 20, 9, 1), set("working", 20, 7, 0)]); assert.equal(d.nextWeight, 18); assert.equal(d.tone, "reduce"); });
test("next exercise uses prior working performance as a reference", () => { const r = nextExerciseRecommendation(cable, [{ ...set("working", 12.5, 15, 2), exerciseId: cable.id }]); assert.equal(r.weight, 12.5); assert.match(r.reason, /sensible starting point/); });
