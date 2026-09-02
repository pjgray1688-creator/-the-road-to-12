import test from "node:test";
import assert from "node:assert/strict";
import { composeAthleteProfile } from "../lib/athlete-profile";
import { scheduleStatus, scheduleWeek } from "../lib/scheduler";
import type { PlannedSession } from "../lib/domain";

const sessions: PlannedSession[] = [
  { id: "s1", day: 1, name: "Upper", status: "planned", exerciseIds: ["flat-bench"] },
  { id: "s2", day: 2, name: "Lower", status: "planned", exerciseIds: ["trap-bar-deadlift"] },
  { id: "s3", day: 3, name: "Accessories", status: "planned", exerciseIds: ["lat-pulldown"] },
  { id: "s4", day: 4, name: "Lower B", status: "planned", exerciseIds: ["leg-press"] }
];
const profile = composeAthleteProfile({ goal: "general_fitness", experience: "experienced", daysPerWeek: 2, sessionMinutes: 60, environment: "full_gym", limitations: [], includeCardio: false }, { availability: { mode: "fixed_days", weekdays: [6, 7], sessionsPerWeek: 2 } });

test("AthleteProfile composes TrainingProfile without duplicating goal or experience", () => { assert.equal(profile.primaryGoal, "general_fitness"); assert.equal(profile.experience, "experienced"); assert.deepEqual(profile.availability.weekdays, [6, 7]); });
test("weekend-only availability is valid and preserves ordered sessions", () => { const result = scheduleWeek(sessions, profile, "2026-09-07"); assert.deepEqual(result.occurrences.map(item => item.scheduledDate), ["2026-09-12", "2026-09-13"]); assert.deepEqual(result.occurrences.map(item => item.programmeSessionId), ["s1", "s2"]); assert.ok(result.evidence.some(item => item.code === "FIXED_AVAILABILITY")); });
test("temporary travel override is scoped and produces a reduced week", () => { const athlete = composeAthleteProfile({ ...profile.training, daysPerWeek: 4 }, { availability: { mode: "flexible_week", sessionsPerWeek: 4 }, temporaryOverrides: [{ startDate: "2026-09-07", endDate: "2026-09-13", availableDays: [3], environment: "limited_gym", sessionMinutes: 45 }] }); const result = scheduleWeek(sessions, athlete, "2026-09-07"); assert.equal(result.occurrences.length, 1); assert.equal(result.occurrences[0].scheduledDate, "2026-09-09"); assert.ok(result.deferredSessionIds.length > 0); assert.ok(result.evidence.some(item => item.code === "TEMPORARY_OVERRIDE")); assert.equal(athlete.training.environment, "full_gym"); });
test("flexible weeks and rotating patterns are deterministic", () => { const flexible = composeAthleteProfile(profile.training, { availability: { mode: "flexible_week", sessionsPerWeek: 3 } }); const a = scheduleWeek(sessions, flexible, "2026-09-07"); const b = scheduleWeek(sessions, flexible, "2026-09-07"); assert.deepEqual(a, b); const rotating = composeAthleteProfile(profile.training, { availability: { mode: "rotating_pattern", weekA: [1, 3], sessionsPerWeek: 2 } }); assert.ok(scheduleWeek(sessions, rotating, "2026-09-07").evidence.some(item => item.code === "ROTATING_AVAILABILITY")); });
test("occurrence statuses distinguish unavailable, missed and completed", () => { const scheduled = scheduleWeek(sessions, profile, "2026-09-07").occurrences[0]; assert.equal(scheduleStatus(scheduled, new Set(), new Set()), "planned"); assert.equal(scheduleStatus(scheduled, new Set([scheduled.occurrenceId]), new Set()), "completed"); assert.equal(scheduleStatus(scheduled, new Set(), new Set([scheduled.occurrenceId])), "missed"); });
