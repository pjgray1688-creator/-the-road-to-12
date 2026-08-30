import assert from "node:assert/strict";
import test from "node:test";
import { adaptSession, assessReadiness, detectStall, rescheduleWeek, substitutionFor } from "../lib/adaptive-coach";
import { currentWeek } from "../lib/domain";

test("readiness uses available data and never invents missing recovery", () => { assert.equal(assessReadiness({}).level, "READY"); assert.equal(assessReadiness({ recovery: { id: "r", date: "today", origin: "real", source: "whoop", recoveryScore: 52 } }).level, "TRAIN WITH CAUTION"); });
test("low recovery reduces demand without rewriting the programme", () => { const d = adaptSession({ recovery: { id: "r", date: "today", origin: "real", source: "whoop", recoveryScore: 52 }, plannedSets: 20, lowerBodyDemand: true }); assert.equal(d.action, "reduce_demand"); assert.equal(d.cardioMinutes, 30); assert.ok(d.reduceSetsBy); });
test("pain takes priority over progression", () => { const d = adaptSession({ pain: true, plannedSets: 12 }); assert.equal(d.action, "rest"); });
test("stall proposal requires three comparable exposures", () => { assert.equal(detectStall([{ date: "1", weight: 80, reps: 10, rir: 2, comparable: true }, { date: "2", weight: 80, reps: 9, rir: 1, comparable: true }], "Incline Machine Press").proposed, false); assert.equal(detectStall([{ date: "1", weight: 80, reps: 10, rir: 2, comparable: true }, { date: "2", weight: 80, reps: 9, rir: 2, comparable: true }, { date: "3", weight: 80, reps: 8, rir: 1, comparable: true }], "Incline Machine Press").proposed, true); });
test("substitutions preserve movement intent and are temporary when safety-driven", () => { const s = substitutionFor("rdl", "pain"); assert.equal(s?.replacement, "Seated Hamstring Curl"); assert.equal(s?.temporary, true); });
test("missed session is marked without shifting every following session", () => { const updated = rescheduleWeek(currentWeek, [], "tue"); assert.equal(updated.find(s => s.id === "tue")?.status, "missed"); assert.equal(updated.find(s => s.id === "wed")?.status, "planned"); });
