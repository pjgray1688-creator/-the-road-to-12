import test from "node:test";
import assert from "node:assert/strict";
import type { LoggedSet } from "../lib/types";
import type { PlannedSession, PlannedSessionStructure } from "../lib/domain";
import { guidedProgress, nextGuidedIndex, structureLabels, timedStructureState } from "../lib/session-structures";

const session: PlannedSession = { id: "s", day: 1, name: "Session", status: "planned", exerciseIds: ["a", "b", "c"], structures: [] };
const set = (exerciseId: string, id = exerciseId): LoggedSet => ({ id, exerciseId, exerciseName: exerciseId, weight: 10, reps: 8, rir: 2, kind: "working", createdAt: new Date().toISOString() });
const structure = (type: PlannedSessionStructure["type"], exerciseIds = ["a", "b"], settings = {}): PlannedSessionStructure => ({ id: `${type}-1`, type, exerciseIds, settings });

test("straight or unknown structure falls back to the flat exercise order", () => {
  assert.deepEqual(nextGuidedIndex({ ...session, structures: [structure("straight")] }, 0, []), { index: 1, completed: false, restSeconds: 0 });
  assert.equal(structureLabels["superset"], "Superset");
});

test("superset sequencing alternates members and completes after its rounds", () => {
  const plan = { ...session, structures: [structure("superset", ["a", "b"], { rounds: 2, restBetweenRoundsSeconds: 60 })] };
  assert.equal(nextGuidedIndex(plan, 0, [set("a")]).index, 1);
  assert.equal(nextGuidedIndex(plan, 1, [set("a"), set("b")]).index, 0);
  const finished = nextGuidedIndex(plan, 0, [set("a", "a1"), set("b", "b1"), set("a", "a2"), set("b", "b2")]);
  assert.equal(finished.completed, true);
  assert.equal(finished.index, 2);
});

test("progress exposes group position and intensity-method stages without changing exercise identity", () => {
  const drop = structure("drop_set", ["a"], { drops: 2 });
  assert.equal(guidedProgress(drop, "a", [set("a")]).stage, "Drop 1 of 2");
  assert.equal(guidedProgress(structure("cluster", ["a"], { clustersPerSet: 4 }), "a", []).stage, "Cluster 1 of 4");
});

test("timed structures derive pause-safe state from elapsed time", () => {
  const emom = timedStructureState(structure("emom", ["a", "b", "c"], { durationMinutes: 12 }), 4 * 60 * 1000 + 1000);
  assert.equal(emom.round, 5);
  assert.equal(emom.stationIndex, 1);
  assert.equal(emom.remaining, 12 * 60 - 4 * 60 - 1);
  const interval = timedStructureState(structure("interval", ["a"], { rounds: 3, workSeconds: 30, restSeconds: 30 }), 35 * 1000);
  assert.equal(interval.phase, "rest");
  assert.equal(interval.round, 1);
  const amrap = timedStructureState(structure("amrap", ["a"], { durationMinutes: 10 }), 2 * 60 * 1000);
  assert.equal(amrap.remaining, 8 * 60);
});
