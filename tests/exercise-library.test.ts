import assert from "node:assert/strict";
import test from "node:test";
import { exerciseKnowledge, exerciseLibrary, filterExercises, legacyExerciseMappings, resolveExerciseId, searchExercises, validateExerciseCatalogue } from "../lib/exercise-library";
import { exerciseById } from "../lib/workout";

test("production exercise catalogue loads all 1,579 research definitions", () => {
  assert.equal(exerciseLibrary.length, 1579);
  assert.equal(new Set(exerciseLibrary.map(item => item.id)).size, 1579);
  assert.equal(legacyExerciseMappings.length, 13);
  assert.deepEqual(validateExerciseCatalogue(), []);
});

test("canonical, alias and legacy exercise resolution is one read-time path", () => {
  assert.equal(resolveExerciseId("incline-db-press"), "incline-db-press");
  const aliased = exerciseLibrary.find(item => item.aliases.length);
  assert.ok(aliased);
  assert.equal(resolveExerciseId(aliased.aliases[0]), aliased.id);
  assert.equal(resolveExerciseId("flat-bench"), "flat-bench-press");
  assert.equal(exerciseKnowledge("flat-bench")?.id, "flat-bench-press");
  assert.equal(resolveExerciseId("vertical-pull", { displayName: "Assisted pull-up", equipment: "machine" }), "assisted-pull-up");
  assert.equal(resolveExerciseId("vertical-pull", { displayName: "Pull-up", equipment: "bodyweight" }), "pull-up");
  assert.equal(exerciseById("flat-bench")?.id, "flat-bench-press");
});

test("exercise search ranks canonical and alias matches and supports composable filters", () => {
  assert.equal(searchExercises("Barbell Row")[0]?.id, "barbell-row");
  assert.equal(searchExercises("bent over row")[0]?.id, "barbell-row");
  assert.ok(searchExercises("", { equipment: "kettlebell" }).every(item => item.equipmentRequired.includes("kettlebell")));
  assert.ok(searchExercises("", { muscle: "quadriceps", movementPattern: "squat", compoundOrIsolation: "compound" }).length > 0);
  assert.ok(filterExercises({ trainingStyle: "bodybuilding", programmeRole: "isolation", reviewStatus: "manual-review" }).every(item => item.reviewStatus === "manual-review" && item.compoundOrIsolation === "isolation"));
  assert.ok(searchExercises("incline", { laterality: "bilateral" }).every(item => item.laterality === "bilateral"));
});

test("prescription metrics and session structures remain separate from exercise identity", () => {
  const cardio = exerciseLibrary.find(item => item.category.includes("cardio"));
  assert.ok(cardio);
  assert.ok(cardio.supportedPrescriptionMetrics.some(metric => ["time", "distance", "pace", "heartRateZone"].includes(metric)));
  const sessionStructureTerms = new Set(["superset", "triset", "giant-set", "circuit", "AMRAP", "EMOM", "intervals", "finisher", "warm-up", "mobility-block"]);
  assert.equal(exerciseLibrary.some(item => sessionStructureTerms.has(item.id) || sessionStructureTerms.has(item.name) || item.aliases.some(alias => sessionStructureTerms.has(alias))), false);
});
