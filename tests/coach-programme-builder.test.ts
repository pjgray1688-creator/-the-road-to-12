import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { addExercise, builderSearch, createStructure, moveExercise, moveSession, prescriptionMetrics, removeExercise, removeStructure, reorderStructureExercise, sessionStructureLabels, updateStructureSettings, updateOverride, validateSessionStructures } from "../lib/coach-programme-builder";
import { exerciseKnowledge } from "../lib/exercise-library";
import type { PlannedSession } from "../lib/domain";

const session = (id: string, exerciseIds: string[] = []): PlannedSession => ({ id, day: 1, name: id, status: "planned", exerciseIds });

test("programme builder searches the canonical library and supports aliases/filters", () => {
  assert.ok(builderSearch("flat bench press").some(item => item.id === "flat-bench-press"));
  assert.ok(builderSearch("bench", { equipment: "barbell" }).every(item => item.equipmentRequired.includes("barbell")));
  assert.ok(builderSearch("", { movementPattern: "horizontal press" }).length > 0);
});

test("programme builder adds canonical exercises without duplicating definitions", () => {
  const next = addExercise(session("Push"), "flat-bench");
  assert.deepEqual(next.exerciseIds, ["flat-bench-press"]);
  assert.equal(next.exerciseOverrides?.["flat-bench-press"]?.sets, 3);
  assert.deepEqual(addExercise(next, "flat-bench").exerciseIds, ["flat-bench-press"]);
});

test("programme builder preserves ordering and prescription overrides", () => {
  const original = addExercise(addExercise(session("Push"), "flat-bench"), "barbell-row");
  const moved = moveExercise(original, 1, -1);
  assert.deepEqual(moved.exerciseIds, ["barbell-row", "flat-bench-press"]);
  const edited = updateOverride(moved, "barbell-row", { reps: "8-10", rir: 2, tempo: "3-1-1", notes: "Pause at the top" });
  assert.equal(edited.exerciseOverrides?.["barbell-row"]?.rir, 2);
  assert.equal(edited.exerciseOverrides?.["barbell-row"]?.tempo, "3-1-1");
});

test("programme builder session ordering is deterministic", () => {
  const week = [session("A"), session("B"), session("C")];
  assert.deepEqual(moveSession(week, 2, -1).map(item => [item.name, item.day]), [["A", 1], ["C", 2], ["B", 3]]);
});

test("prescription fields follow the selected exercise metadata", () => {
  const strength = prescriptionMetrics("flat-bench");
  assert.ok(strength.includes("reps"));
  const cardio = exerciseKnowledge("rower") ?? exerciseKnowledge("rowing");
  if (cardio) assert.ok(prescriptionMetrics(cardio.id).some(metric => ["time", "distance", "calories", "pace"].includes(metric)));
});

test("Coach programme builder has an authoritative save boundary and Cover read-only UI", () => {
  const route = fs.readFileSync("app/api/coach/programme/route.ts", "utf8");
  const migration = fs.readFileSync("supabase/migrations/2026-11-28-coach-programme-builder.sql", "utf8");
  const component = fs.readFileSync("components/coach-programme-builder.tsx", "utf8");
  assert.match(route, /coach_save_programme_block/);
  assert.doesNotMatch(route, /coach_save_programme\"/);
  assert.match(migration, /relationship_type='primary'/);
  assert.match(migration, /programme_owner_user_id/);
  assert.match(component, /canManage/);
  assert.match(component, /Save programme/);
  assert.match(component, /Review/);
});

test("programme context resolution keeps direct and Club identifiers separate", () => {
  const migration = fs.readFileSync("supabase/migrations/2026-11-28-coach-programme-builder.sql", "utf8");
  const context = migration.slice(migration.indexOf("create or replace function public.coach_resolve_programme_context"), migration.indexOf("create or replace function public.coach_validate_block_definition"));
  assert.match(context, /p_relationship_id is null/);
  assert.match(context, /r\.id=p_relationship_id/);
  assert.match(context, /p_assignment_id is null/);
  assert.match(context, /a\.id=p_assignment_id/);
  assert.match(context, /p\.relationship_id=v_primary\.id/);
  assert.match(context, /p\.assignment_id=v_primary_assignment\.id/);
  assert.doesNotMatch(context, /coalesce\(p_relationship_id,p_assignment_id\)/);
});

test("block save RPC validates malformed and pathological JSON before writing", () => {
  const migration = fs.readFileSync("supabase/migrations/2026-11-28-coach-programme-builder.sql", "utf8");
  const validation = migration.slice(migration.indexOf("create or replace function public.coach_validate_block_definition"), migration.indexOf("create or replace function public.coach_list_programme_blocks"));
  assert.match(validation, /jsonb_typeof\(p_definition\) is distinct from 'object'/);
  assert.match(validation, /jsonb_typeof\(p_definition->'week'\) is distinct from 'array'/);
  assert.match(validation, /jsonb_typeof\(s->'exerciseIds'\) is distinct from 'array'/);
  assert.match(validation, /jsonb_array_length\(s->'exerciseIds'\)>100/);
  assert.match(validation, /jsonb_typeof\(o\) is distinct from 'object'/);
  assert.doesNotMatch(validation, /jsonb_object_length/);
  assert.match(validation, /select count\(\*\) into o_n from jsonb_object_keys\(o\)/);
  assert.ok(validation.indexOf("jsonb_typeof(p_definition->'week')") < validation.indexOf("jsonb_array_length(p_definition->'week')"));
});

test("current generated programme shape remains represented by the RPC contract", () => {
  const migration = fs.readFileSync("supabase/migrations/2026-11-28-coach-programme-builder.sql", "utf8");
  const generatedProgramme = JSON.stringify({ id: "programme-1", name: "Strength block", profile: {}, block: {}, week: [{ id: "day-1", day: 1, name: "Push", status: "planned", exerciseIds: ["flat-bench-press"], exerciseOverrides: { "flat-bench-press": { sets: 3, target: "8-10", rir: 2 } } }], rationale: "Progressive training" });
  const parsed = JSON.parse(generatedProgramme);
  assert.equal(typeof parsed.id, "string");
  assert.equal(Array.isArray(parsed.week), true);
  assert.match(migration, /generated_programme=p_definition/);
  assert.match(migration, /active_programme_id=p_definition->>'id'/);
});

test("programme blocks provide durable history without replacing the member projection", () => {
  const migration = fs.readFileSync("supabase/migrations/2026-11-28-coach-programme-builder.sql", "utf8");
  assert.match(migration, /create table if not exists public\.coach_programmes/);
  assert.match(migration, /create table if not exists public\.coach_programme_blocks/);
  assert.match(migration, /create table if not exists public\.coach_programme_block_revisions/);
  assert.match(migration, /coach_programme_blocks_one_active/);
  assert.match(migration, /where status='active'/);
  assert.match(migration, /planned_weeks integer check/);
  assert.match(migration, /coach_create_programme_block/);
  assert.match(migration, /coach_save_programme_block/);
  assert.match(migration, /coach_activate_programme_block/);
  assert.match(migration, /coach_list_programme_revisions/);
  assert.match(migration, /insert into public\.coach_programme_block_revisions/);
  assert.match(migration, /generated_programme=p_definition/);
  assert.match(migration, /status='completed'/);
  assert.match(migration, /Only a draft block can be activated/);
});

test("programme blocks retain direct and Club context identifiers without substitution", () => {
  const migration = fs.readFileSync("supabase/migrations/2026-11-28-coach-programme-builder.sql", "utf8");
  const context = migration.slice(migration.indexOf("create or replace function public.coach_resolve_programme_context"), migration.indexOf("create or replace function public.coach_validate_block_definition"));
  assert.match(context, /p_relationship_id is null/);
  assert.match(context, /r\.id=p_relationship_id/);
  assert.match(context, /p_assignment_id is null/);
  assert.match(context, /a\.id=p_assignment_id/);
  assert.match(migration, /check \(\(organisation_id is null and relationship_id is not null and assignment_id is null\)/);
});

test("block definition validation is bounded before array expansion", () => {
  const migration = fs.readFileSync("supabase/migrations/2026-11-28-coach-programme-builder.sql", "utf8");
  const validation = migration.slice(migration.indexOf("create or replace function public.coach_validate_block_definition"), migration.indexOf("create or replace function public.coach_list_programme_blocks"));
  assert.match(validation, /jsonb_typeof\(p_definition\) is distinct from 'object'/);
  assert.match(validation, /jsonb_typeof\(p_definition->'week'\) is distinct from 'array'/);
  assert.ok(validation.indexOf("jsonb_typeof(p_definition->'week')") < validation.indexOf("jsonb_array_length(p_definition->'week')"));
});

test("Coach block API exposes draft, activation, status and revision actions", () => {
  const route = fs.readFileSync("app/api/coach/programme/route.ts", "utf8");
  const component = fs.readFileSync("components/coach-programme-blocks.tsx", "utf8");
  assert.match(route, /coach_list_programme_blocks/);
  assert.match(route, /coach_create_programme_block/);
  assert.match(route, /coach_activate_programme_block/);
  assert.match(route, /coach_set_programme_block_status/);
  assert.match(route, /coach_list_programme_revisions/);
  assert.match(component, /Duplicate as draft/);
  assert.match(component, /REVISION HISTORY/);
  assert.match(component, /blockId/);
});

test("the block architecture has no legacy write bypass and keeps helpers private", () => {
  const migration = fs.readFileSync("supabase/migrations/2026-11-28-coach-programme-builder.sql", "utf8");
  const route = fs.readFileSync("app/api/coach/programme/route.ts", "utf8");
  assert.doesNotMatch(migration, /create or replace function public\.coach_save_programme\(/);
  assert.doesNotMatch(migration, /grant execute on function public\.coach_save_programme/);
  assert.doesNotMatch(route, /coach_save_programme(?!_block)/);
  assert.match(migration, /revoke all on function public\.coach_resolve_programme_context/);
  assert.match(migration, /grant execute on function public\.coach_list_programme_blocks/);
  assert.doesNotMatch(migration, /grant execute on function public\.coach_resolve_programme_context/);
});

test("programme and revision reads are bound to the resolved programme and block", () => {
  const migration = fs.readFileSync("supabase/migrations/2026-11-28-coach-programme-builder.sql", "utf8");
  assert.match(migration, /where b\.programme_id=v_context\.programme_id/);
  assert.match(migration, /where id=p_block_id and programme_id=v_context\.programme_id/);
  assert.match(migration, /Programme block access denied/);
});

test("saves and activation use row locks, immutable revisions, and deterministic active transitions", () => {
  const migration = fs.readFileSync("supabase/migrations/2026-11-28-coach-programme-builder.sql", "utf8");
  assert.match(migration, /where b\.id=p_block_id and b\.programme_id=v_context\.programme_id for update/);
  assert.match(migration, /where id=v_context\.programme_id for update/);
  assert.match(migration, /create unique index if not exists coach_programme_blocks_one_active/);
  assert.match(migration, /Activate a successor before completing or archiving the active block/);
  assert.match(migration, /coach_programme_revisions_immutable/);
});

test("session structures extend the flat exercise order without creating exercise identities", () => {
  const base = addExercise(addExercise(addExercise(session("Push"), "flat-bench"), "barbell-row"), "lateral-raise");
  const grouped = createStructure(base, "superset", ["flat-bench-press", "barbell-row"], { rounds: 3, restBetweenExercisesSeconds: 75 });
  assert.deepEqual(grouped.exerciseIds, base.exerciseIds);
  assert.equal(grouped.structures?.[0].type, "superset");
  assert.deepEqual(grouped.structures?.[0].exerciseIds, ["flat-bench-press", "barbell-row"]);
  assert.equal(sessionStructureLabels.superset, "Superset");
  assert.equal(validateSessionStructures(grouped).length, 0);
  assert.deepEqual(reorderStructureExercise(grouped, grouped.structures![0].id, 1, -1).structures?.[0].exerciseIds, ["barbell-row", "flat-bench-press"]);
  const ungrouped = removeStructure(grouped, grouped.structures![0].id);
  assert.equal(ungrouped.structures?.length, 0);
  assert.deepEqual(removeExercise(grouped, "barbell-row").structures?.[0].exerciseIds, ["flat-bench-press"]);
});

test("all advanced session structures retain bounded settings and validate their shape", () => {
  const base = ["flat-bench", "barbell-row", "lateral-raise", "cable-fly"].reduce((value, id) => addExercise(value, id), session("Conditioning"));
  const types = ["triset", "giant_set", "circuit", "drop_set", "mechanical_drop", "rest_pause", "cluster", "emom", "amrap", "interval", "ladder", "pyramid", "complex"] as const;
  for (const type of types) {
    const ids = type === "drop_set" || type === "mechanical_drop" || type === "rest_pause" || type === "cluster" ? [base.exerciseIds[0]] : type === "triset" ? base.exerciseIds.slice(0, 3) : type === "complex" ? base.exerciseIds.slice(0, 2) : base.exerciseIds;
    const settings = type === "ladder" || type === "pyramid" ? { steps: "2 / 4 / 6 / 8" } : type === "interval" ? { workSeconds: 30, restSeconds: 30, rounds: 4 } : type === "amrap" || type === "emom" ? { durationMinutes: 10 } : { rounds: 3 };
    const structure = createStructure(base, type, ids, settings).structures?.[0];
    assert.ok(structure, type);
    assert.equal(validateSessionStructures({ ...base, structures: [structure!] }).length, 0, type);
  }
});

test("malformed structures are rejected before the programme save boundary", () => {
  const base = addExercise(addExercise(session("Bad"), "flat-bench"), "barbell-row");
  assert.ok(validateSessionStructures({ ...base, structures: [{ id: "x", type: "superset", exerciseIds: ["flat-bench-press"] }] }).some(issue => issue.includes("at least 2")));
  assert.ok(validateSessionStructures({ ...base, structures: [{ id: "x", type: "circuit", exerciseIds: ["not-an-exercise", "barbell-row"] }] }).some(issue => issue.includes("outside the session")));
  assert.ok(validateSessionStructures({ ...base, structures: [{ id: "x", type: "ladder", exerciseIds: ["flat-bench-press"], settings: {} }] }).some(issue => issue.includes("steps")));
  assert.ok(validateSessionStructures({ ...base, structures: [{ id: "x", type: "interval", exerciseIds: ["flat-bench-press"], settings: { workSeconds: 0, restSeconds: 30, rounds: 2 } }] }).some(issue => issue.includes("workSeconds")));
});

test("structure changes use block revisions, preserve Cover read-only behaviour, and keep the live migration boundary explicit", () => {
  const migration = fs.readFileSync("supabase/migrations/2026-11-29-coach-session-structures.sql", "utf8");
  const builder = fs.readFileSync("components/coach-programme-builder.tsx", "utf8");
  const workspace = fs.readFileSync("components/coach-workspace.tsx", "utf8");
  assert.match(migration, /coach_validate_session_structures/);
  assert.match(migration, /before insert or update of definition/);
  assert.match(builder, /Create structure/);
  assert.match(builder, /Ungroup/);
  assert.match(builder, /canManage/);
  assert.match(workspace, /coach-add-client-action/);
  assert.doesNotMatch(migration, /create table/);
});
