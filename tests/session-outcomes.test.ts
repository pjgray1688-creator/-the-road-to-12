import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { adherenceSummary, canCompleteWorkout, endWorkoutEarly, planMissedSessionSalvage, sessionOutcome } from "../lib/session-outcomes";
import type { PlannedSession } from "../lib/domain";
import { currentWeek } from "../lib/domain";
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

test("Original Heavy Lower review produces a real proposal or explicit no-salvage result", () => {
  const missed = currentWeek.find(item => item.id === "tue")!;
  const later = currentWeek.filter(item => item.day > missed.day && item.status === "planned");
  const result = planMissedSessionSalvage(missed, later, [], { goal: "general_fitness", experience: "experienced", daysPerWeek: 5, sessionMinutes: 90, environment: "full_gym", limitations: [], includeCardio: false });
  assert.ok(result === undefined || result.title.length > 0);
  if (result) assert.match(result.detail, /missed|add/i);
});

test("consumer UI exposes explicit missed and partial actions", () => {
  const dashboard = fs.readFileSync("components/missed-session-action.tsx", "utf8");
  const workout = fs.readFileSync("components/training-app.tsx", "utf8");
  assert.match(dashboard, /Mark session missed/);
  assert.match(dashboard, /status: "missed"/);
  assert.match(dashboard, /Review missed work/);
  assert.match(dashboard, /Apply changes/);
  assert.doesNotMatch(dashboard, /window\.(confirm|prompt|alert)/);
  assert.match(dashboard, /programme-action-modal/);
  assert.match(dashboard, /Why did you miss it/);
  assert.match(dashboard, /No catch-up recommended/);
  assert.match(workout, /START WORKOUT[\s\S]*MissedSessionAction/);
  assert.match(workout, /End workout early/);
  assert.match(workout, /marked Partial/);
  assert.match(workout, /endServerWorkoutEarly/);
  assert.match(workout, /clearActiveWorkout\(\)/);
});

test("current-week salvage is consumed by the active workout itinerary", () => {
  const active = fs.readFileSync("lib/active-programme.ts", "utf8");
  const action = fs.readFileSync("components/missed-session-action.tsx", "utf8");
  assert.match(active, /salvageAdjustments/);
  assert.match(active, /exerciseIds\.push/);
  assert.match(action, /source: today\.session\.id/);
  assert.match(action, /Current-week option only/);
});

test("partial outcome is persisted in server metadata without changing schema status", () => {
  const route = fs.readFileSync("app/api/workouts/[id]/route.ts", "utf8");
  const repository = fs.readFileSync("lib/workout-repository.ts", "utf8");
  const sync = fs.readFileSync("lib/workout-sync.ts", "utf8");
  assert.match(route, /body\.outcome === "partial"/);
  assert.match(route, /outcome: "partial"/);
  assert.match(route, /status: partial \? "completed"/);
  assert.match(repository, /metadata\.outcome === "partial"/);
  assert.match(sync, /outcome: "partial"/);
});
