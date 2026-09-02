import test from "node:test";
import assert from "node:assert/strict";
import { resolveTodayOccurrence, resolveWeekSchedule } from "../lib/schedule-resolver";
import { currentWeek } from "../lib/domain";
import type { AppData } from "../lib/types";

const data = (extra: Partial<AppData> = {}): AppData => ({ version: 2, workouts: [], bodyMetrics: [], meals: [], ...extra });
test("canonical resolver returns dated Original occurrences without availability data", () => { const result = resolveWeekSchedule(currentWeek, data(), "Europe/London", new Date("2026-09-02T12:00:00Z")); assert.ok(result.occurrences.some(item => item.programmeSessionId === "tue" && item.scheduledDate === "2026-09-01")); assert.equal(resolveTodayOccurrence(currentWeek, data(), "Europe/London", new Date("2026-09-02T12:00:00Z"))?.programmeSessionId, "wed"); });
test("dated status applies only to its occurrence", () => { const result = resolveWeekSchedule(currentWeek, data({ sessionStatusOverrides: { "active:tue:2026-09-01": { status: "missed" } } }), "Europe/London", new Date("2026-09-08T12:00:00Z")); const next = result.occurrences.find(item => item.programmeSessionId === "tue"); assert.equal(next?.scheduledDate, "2026-09-08"); assert.equal(next?.status, "planned"); });
test("completed and partial workouts resolve through dated occurrence identity", () => { const result = resolveWeekSchedule(currentWeek, data({ workouts: [{ id: "w", name: "Heavy Lower", plannedSessionId: "tue", scheduledDate: "2026-09-01", status: "completed", completedAt: "2026-09-01", startedAt: "2026-09-01", sets: [], substitutions: {}, notes: [] }] }), "Europe/London", new Date("2026-09-02T12:00:00Z")); assert.equal(result.occurrences.find(item => item.programmeSessionId === "tue")?.status, "completed"); });
