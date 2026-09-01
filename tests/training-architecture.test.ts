import test from "node:test";
import assert from "node:assert/strict";
import { allExercises, exerciseById } from "../lib/workout";
import { disciplineContract, disciplineContracts, disciplineForProfile, equipmentOntology, exerciseVariant, frameworksForDiscipline, movementFamilies, phaseForDiscipline } from "../lib/training-architecture";
import { generateTrainingProgramme } from "../lib/programme-generator";
import { legacyProgrammeSnapshot } from "../lib/legacy-programme";

const base = { goal: "general_fitness" as const, experience: "beginner" as const, daysPerWeek: 3 as const, sessionMinutes: 60 as const, environment: "full_gym" as const, limitations: [], includeCardio: false };
test("all disciplines resolve to typed contracts without collapsing their identities", () => {
  for (const id of Object.keys(disciplineContracts) as Array<keyof typeof disciplineContracts>) assert.equal(disciplineContract(id).id, id);
  assert.notDeepEqual(frameworksForDiscipline("strength"), frameworksForDiscipline("powerlifting"));
  assert.notEqual(disciplineForProfile({ ...base, goal: "muscle_gain" }), "general_fitness");
  assert.equal(phaseForDiscipline("return_to_training"), "re_acclimation");
});
test("return and accessible capability remain independent from experience", () => {
  assert.equal(disciplineForProfile({ ...base, discipline: "return_to_training", experience: "experienced" }), "return_to_training");
  const contract = disciplineContract("accessible_training"); assert.ok(contract.frameworks.includes("full_body"));
  assert.equal(disciplineContract("accessible_training").id, "accessible_training");
});
test("specialist Olympic and Strongman taxonomy is isolated from general output", () => {
  assert.equal(disciplineContract("olympic_weightlifting").technicalEligibility, "intermediate");
  assert.ok(equipmentOntology.log && equipmentOntology.yoke && equipmentOntology.sandbag);
  const general = generateTrainingProgramme(base, undefined, "architecture"); assert.ok(!general.week.flatMap(s => s.exerciseIds).some(id => /clean|snatch|yoke|stone/i.test(id)));
});
test("movement families and variants provide scalable relationships", () => {
  assert.ok(Object.keys(movementFamilies).length >= 8);
  const row = exerciseVariant(exerciseById("barbell-row")!); assert.equal(row.movementFamily, "horizontal_row");
  assert.equal(new Set(allExercises().map(e => e.id)).size, allExercises().length);
  assert.ok(allExercises().every(e => exerciseVariant(e).movementFamily));
});
test("legacy programme and persisted generated programmes remain compatible", () => {
  const original = legacyProgrammeSnapshot(); const generated = generateTrainingProgramme(base, undefined, "stable");
  assert.equal(original.isLegacy, true); assert.equal(original.week[1].name, "Heavy Lower"); assert.equal(generated.block.totalWeeks, 4);
});
