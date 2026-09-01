import test from "node:test";
import assert from "node:assert/strict";
import { adherenceSummary, canCompleteWorkout, endWorkoutEarly, planMissedSessionSalvage, sessionOutcome } from "../lib/session-outcomes";
import type { PlannedSession } from "../lib/domain";
import type { Workout } from "../lib/types";

const session = (id: string, name = id): PlannedSession => ({ id, day: 1, name, status: "planned", exerciseIds: ["leg-press", "hamstring-curl"] });
const workout = (id: string, status: Workout["status"] = "completed"): Workout => ({ id, name: id, plannedSessionId: id, startedAt: "2026-09-01T10:00:00Z", completedAt: status === "completed" ? "2026-09-01T11:00:00Z" : undefined, status, sets: [{ id: `${id}-set`, exerciseId: "leg-press", exerciseName: "Leg Press", weight: 80, reps: 8, kind: "working", createdAt: "2026-09-01T10:30:00Z", rir: 2 }], substitutions: {}, notes: [] });

test("outcomes distinguish completed, partial, discarded and empty ghosts", () => {
  assert.equal(sessionOutcome(workout("a")), "completed");
  assert.equal(sessionOutcome(endWorkoutEarly(workout("b", "active"))), "partial");
  assert.equal(sessionOutcome({ ...workout("c"), outcome: "discarded" }), "discarded");
  assert.equal(canCompleteWorkout({ sets: [], cardio: undefined }), false);
  assert.equal(canCompleteWorkout({ sets: workout("d").sets, cardio: undefined }), true);
});

test("adherence records missed and partial without fabricating completion", () => {
  const result = adherenceSummary([session("a"), session("b"), session("c")], [workout("a"), endWorkoutEarly(workout("b", "active"))], { c: { status: "missed" } });
  assert.deepEqual(result, { planned: 0, completed: 1, partial: 1, missed: 1 });
});

test("missed-session salvage is a bounded approval-only proposal", () => {
  const proposal = planMissedSessionSalvage(session("missed", "Heavy Lower"), [session("later", "Lower Accessories")], [], { goal: "muscle_gain", experience: "intermediate", daysPerWeek: 4, sessionMinutes: 60, environment: "full_gym", limitations: [], includeCardio: false });
  assert.ok(proposal);
  assert.equal(proposal?.requiresApproval, true);
  assert.ok((proposal?.additions.length ?? 0) <= 2);
  assert.equal(planMissedSessionSalvage(session("missed"), [], [], { goal: "muscle_gain", experience: "intermediate", daysPerWeek: 4, sessionMinutes: 60, environment: "full_gym", limitations: [], includeCardio: false }), undefined);
});
