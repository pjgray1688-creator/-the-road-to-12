import test from "node:test";
import assert from "node:assert/strict";
import { allExercises } from "../lib/workout";
import { generateTrainingProgramme } from "../lib/programme-generator";
import { conditioningFor, detectProgrammeEditIntent, frameworkFor, taxonomyForExercise, validateProgramme, weeklyVolume } from "../lib/programming-v2";
import type { TrainingProfile } from "../lib/training-profile";

const profile = (overrides: Partial<TrainingProfile> = {}): TrainingProfile => ({ goal: "muscle_gain", experience: "intermediate", daysPerWeek: 4, sessionMinutes: 60, environment: "full_gym", limitations: [], includeCardio: false, ...overrides });

test("V2 frameworks are deliberate across frequency and deterministic", () => {
  assert.equal(frameworkFor(profile({ daysPerWeek: 2 })), "full_body_ab");
  assert.equal(frameworkFor(profile({ daysPerWeek: 4 })), "upper_lower");
  assert.equal(frameworkFor(profile({ daysPerWeek: 5 })), "ppl_plus");
  assert.equal(frameworkFor(profile({ daysPerWeek: 6, experience: "experienced" })), "ppl_ab");
  const a = generateTrainingProgramme(profile({ daysPerWeek: 5 }), undefined, "v2");
  const b = generateTrainingProgramme(profile({ daysPerWeek: 5 }), undefined, "v2");
  assert.deepEqual(a.week, b.week);
  assert.ok(a.week.some(s => s.name.includes(" A")) && a.week.some(s => s.name.includes(" B")));
});

test("V2 volume validator prevents the former upper-heavy five-day imbalance", () => {
  const programme = generateTrainingProgramme(profile({ daysPerWeek: 5, experience: "experienced", sessionMinutes: 90 }), undefined, "balance");
  const volume = weeklyVolume(programme.week);
  assert.ok((volume.quads ?? 0) >= 6);
  assert.ok((volume.hamstrings ?? 0) >= 6);
  assert.ok((volume.back_width ?? 0) + (volume.back_thickness ?? 0) <= 28);
  assert.equal(validateProgramme(programme.week, programme.profile).valid, true);
});

test("priorities, wanted exercises, limitations and conditioning are consumed", () => {
  const programme = generateTrainingProgramme(profile({ daysPerWeek: 3, priorities: ["glutes"], wantedExercises: ["barbell-hip-thrust"], includeCardio: true, conditioningPreference: "separate_day", conditioningFrequency: 2 }), undefined, "personal");
  assert.ok(programme.week.flatMap(s => s.exerciseIds).includes("barbell-hip-thrust"));
  assert.equal(programme.conditioning?.length, 2);
  assert.ok(programme.conditioning?.every(c => c.placement === "separate_day"));
  const knee = generateTrainingProgramme(profile({ limitations: ["knee"], daysPerWeek: 3 }), undefined, "knee");
  assert.ok(!knee.week.flatMap(s => s.exerciseIds).some(id => ["leg-press", "hack-squat", "leg-extension"].includes(id)));
});

test("exercise library taxonomy is complete enough for safe programming", () => {
  const exercises = allExercises(); assert.ok(exercises.length >= 50); assert.equal(new Set(exercises.map(e => e.id)).size, exercises.length);
  for (const exercise of exercises) { const taxonomy = taxonomyForExercise(exercise); assert.ok(taxonomy.movement && taxonomy.muscles.length && taxonomy.family); }
});

test("programme edit intents remain structured and deterministic", () => {
  assert.equal(detectProgrammeEditIntent("Please replace this with hip thrusts")?.kind, "replace");
  assert.equal(detectProgrammeEditIntent("I want more glute focus")?.kind, "priority");
  assert.equal(detectProgrammeEditIntent("I hate treadmill cardio")?.kind, "remove");
  assert.equal(detectProgrammeEditIntent("just had a great set"), undefined);
});
