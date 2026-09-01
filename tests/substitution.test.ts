import test from "node:test";
import assert from "node:assert/strict";
import { detectSubstitutionIntent, rankSubstitutions } from "../lib/substitution";
import { exerciseById, allExercises } from "../lib/workout";
import { serverSessionToWorkout } from "../lib/workout-repository";

test("coach detects equipment and pain substitution intents without hijacking performance feedback", () => {
  assert.equal(detectSubstitutionIntent("the leg press is busy").kind, "equipment_unavailable");
  assert.equal(detectSubstitutionIntent("can I use dumbbells instead?").kind, "request_equipment_variant");
  assert.equal(detectSubstitutionIntent("my knee hurts").kind, "pain_or_discomfort");
  assert.equal(detectSubstitutionIntent("that felt very easy").kind, "performance_feedback");
});

test("ranked substitutions preserve movement intent and expose replacement loading profiles", () => {
  const source = exerciseById("leg-press")!;
  const options = rankSubstitutions(source, allExercises(), detectSubstitutionIntent("machine is busy"));
  assert.ok(options.length > 0 && options.length <= 5);
  assert.ok(options.some(option => option.exercise.id === "hack-squat"));
  assert.ok(options.every(option => option.exercise.id !== source.id && option.profile.category));
});

test("equipment-specific requests rank compatible alternatives without copying raw load units", () => {
  const source = exerciseById("incline-db-press")!;
  const options = rankSubstitutions(source, allExercises(), detectSubstitutionIntent("can I use a machine instead?"));
  assert.equal(options[0]?.exercise.id, "incline-machine-press");
  assert.notEqual(options[0]?.profile.unit, "per_hand");
});

test("unknown exercises fail safely", () => {
  const unknown = { ...exerciseById("leg-press")!, id: "custom", name: "Custom Movement" };
  assert.doesNotThrow(() => rankSubstitutions(unknown, allExercises()));
});

test("substitution relationship survives server workout hydration", () => {
  const substitutionDetails = [{ originalExerciseId: "leg-press", replacementExerciseId: "hack-squat", originalExerciseName: "Leg Press", replacementExerciseName: "Hack Squat", reason: "machine busy", createdAt: "2026-09-01T10:00:00Z" }];
  const workout = serverSessionToWorkout({ id: "w", user_id: "u", planned_session_id: "tue", scheduled_date: "2026-09-01", status: "active", name: "Lower", workout_type: "strength", started_at: "2026-09-01T09:00:00Z", completed_at: null, origin: "real", source: "app", version: 1, metadata: { substitutions: { "leg-press": "Hack Squat" }, substitutionDetails }, created_at: "", updated_at: "" });
  assert.deepEqual(workout.substitutionDetails, substitutionDetails);
});
