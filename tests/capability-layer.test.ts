import assert from "node:assert/strict";
import test from "node:test";
import { exerciseKnowledge } from "../lib/exercise-library";
import { magnitudeLoad, progressionProfile, rampLoad } from "../lib/progression";
import { mondayExercises } from "../lib/workout";
import { adaptSession, assessReadiness, rescheduleWeek, substitutionFor } from "../lib/adaptive-coach";
import { currentWeek } from "../lib/domain";

test("exercise knowledge preserves specific intent", () => { const item = exerciseKnowledge("incline-db-press"); assert.ok(item?.emphasis.includes("upper chest emphasis")); assert.ok(item?.substitutions.includes("incline-machine-press")); assert.equal(item?.stabilityDemand, "medium"); });
test("dumbbell magnitude can make more than one increment when clearly underloaded", () => { const result = magnitudeLoad(mondayExercises[0], 20, 20, 10, 5); assert.equal(result, 26); });
test("leg press uses proportional plate-style ramp jumps", () => { const leg = { ...mondayExercises[0], id: "leg-press", name: "Leg Press", equipment: "machine" as const, stackIncrement: 5, defaultWorkingWeight: 300 }; assert.equal(progressionProfile(leg).kind, "plate_loaded_machine"); assert.equal(rampLoad(leg, 120, 300), 140); });
test("substitution explains and preserves intent", () => { const result = substitutionFor("incline-db-press", "pain"); assert.equal(result?.replacement, "Incline Machine Press"); assert.equal(result?.temporary, true); });
test("recovery input changes session demand without fake data", () => { assert.equal(assessReadiness({}).level, "READY"); assert.equal(adaptSession({ fatigue: true, recovery: { id: "r", date: "today", origin: "real", source: "manual", fatigue: 5 }, plannedSets: 18 }).action, "reduce_demand"); });
test("missed sessions remain missed and later plans remain planned", () => { const result = rescheduleWeek(currentWeek, [], "tue"); assert.equal(result.find(item => item.id === "tue")?.status, "missed"); assert.equal(result.find(item => item.id === "wed")?.status, "planned"); });
