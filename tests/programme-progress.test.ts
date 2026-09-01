import test from "node:test";
import assert from "node:assert/strict";
import { programmeSnapshot } from "../lib/programme-progress";
import { currentBlock } from "../lib/domain";
import type { PlannedSession } from "../lib/domain";
import type { Workout } from "../lib/types";

const week: PlannedSession[] = [1, 2, 3].map(day => ({ id: `day-${day}`, day, name: `Day ${day}`, status: "planned", exerciseIds: [`exercise-${day}`] }));
const workout = (id: string, plannedSessionId: string, origin: Workout["origin"] = "real"): Workout => ({ id, name: plannedSessionId, plannedSessionId, scheduledDate: "2026-09-01", startedAt: "2026-09-01", completedAt: "2026-09-01", status: "completed", origin, sets: [{ id: `${id}-set`, exerciseId: "exercise", exerciseName: "Exercise", kind: "working", weight: 10, reps: 8, createdAt: "2026-09-01" }], substitutions: {}, notes: [] });

test("programme snapshot derives progress and next workout from completed history", () => { const snapshot = programmeSnapshot("Build Strength", currentBlock, week, [workout("one", "day-1")], true); assert.equal(snapshot.completedSessions, 1); assert.equal(snapshot.nextSession?.id, "day-2"); assert.equal(snapshot.totalWeeks, 4); assert.ok(snapshot.progressPercent > 0); });
test("test and discarded records do not advance programme progress", () => { const snapshot = programmeSnapshot("Build Strength", currentBlock, week, [workout("test", "day-1", "test"), { ...workout("active", "day-2"), completedAt: undefined, status: "active" }], true); assert.equal(snapshot.completedSessions, 0); assert.equal(snapshot.nextSession?.id, "day-1"); });
