import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { defaultTrainingProfile } from "../lib/training-profile";
import { generateTrainingProgramme } from "../lib/programme-generator";
import { activeWorkoutsFromPayload } from "../lib/programme-activation";

test("account programme persistence is user-scoped and stores the accepted snapshot", () => {
  const route = fs.readFileSync("app/api/training-profile/route.ts", "utf8");
  const migration = fs.readFileSync("supabase/migrations/2026-09-01-training-programmes.sql", "utf8");
  assert.match(route, /supabase\.auth\.getUser/);
  assert.match(route, /\.eq\("id", user\.id\)/);
  assert.match(route, /generated_programme/);
  assert.match(migration, /training_profile jsonb/);
  assert.match(migration, /active_programme_id text/);
});

test("generated programme identity is stable and does not depend on reload-time regeneration", () => {
  const first = generateTrainingProgramme(defaultTrainingProfile);
  const second = generateTrainingProgramme(defaultTrainingProfile);
  assert.equal(first.id, second.id);
  assert.deepEqual(first.week, second.week);
  assert.equal(first.block.id, second.block.id);
});

test("legacy users retain fixed programme fallback when no generated programme is present", () => {
  const source = fs.readFileSync("lib/active-programme.ts", "utf8");
  assert.match(source, /loadGeneratedProgramme\(\)\?\.week \?\? currentWeek/);
});

test("new users receive a visible build-programme entry point", () => {
  const source = fs.readFileSync("components/home-shell.tsx", "utf8");
  assert.match(source, /Build my programme/);
  assert.match(source, /\/onboarding/);
});

test("activation normalizes the workouts API envelope for active-workout protection", () => {
  assert.equal(activeWorkoutsFromPayload({ workouts: [{ status: "completed" }, { status: "active" }] }).length, 1);
  assert.equal(activeWorkoutsFromPayload({ sessions: [{ status: "active" }] }).length, 1);
  assert.equal(activeWorkoutsFromPayload({ workouts: [] }).length, 0);
});

test("onboarding activation is server-first, confirmed, guarded and retryable", () => {
  const source = fs.readFileSync("app/onboarding/page.tsx", "utf8");
  assert.match(source, /disabled=\{activating\}/);
  assert.match(source, /activeWorkoutsFromPayload/);
  assert.match(source, /persisted\.active_programme_id !== programme\.id/);
  assert.match(source, /saveTrainingProfile\(profile, persisted\.generated_programme\); router\.push/);
  assert.match(source, /We couldn’t save this programme/);
});

test("programme replacement archives the prior generated snapshot without changing its identity", () => {
  const route = fs.readFileSync("app/api/training-profile/route.ts", "utf8");
  assert.match(route, /previousProgrammes/);
  assert.match(route, /current\.generated_programme/);
  assert.match(route, /active_programme_id: generatedProgramme\.id/);
});

test("programme creation can be cancelled without activation", () => {
  const source = fs.readFileSync("app/onboarding/page.tsx", "utf8");
  assert.match(source, /href="\/training"/);
  assert.match(source, /Change answers/);
});

test("legacy personal programme is available through the canonical programme contract", () => {
  const source = fs.readFileSync("lib/legacy-programme.ts", "utf8");
  assert.match(source, /legacy-personal-programme/);
  assert.match(source, /currentBlock/);
  assert.match(source, /currentWeek/);
});

test("Training exposes reversible programme switching with active-workout protection", () => {
  const source = fs.readFileSync("app/training/page.tsx", "utf8");
  assert.match(source, /Original programme/);
  assert.match(source, /previousProgrammes/);
  assert.match(source, /loadActiveWorkout/);
  assert.match(source, /Finish or discard your current workout before switching programmes/);
  assert.match(source, /active_programme_id !== programme\.id/);
});

test("inactive programme opens actions and never activates from the row", () => {
  const source = fs.readFileSync("app/training/page.tsx", "utf8");
  assert.match(source, /setSelectedProgramme\(option\)/);
  assert.match(source, /Use this programme/);
  assert.match(source, /Delete this saved programme definition/);
});

test("archive deletion is server-first and protects the active programme", () => {
  const route = fs.readFileSync("app/api/training-profile/route.ts", "utf8");
  assert.match(route, /removeProgrammeId/);
  assert.match(route, /active programme cannot be deleted/);
  assert.match(route, /previousProgrammes/);
});

test("programme action sheet keeps inactive actions above the mobile navigation", () => {
  const source = fs.readFileSync("app/training/page.tsx", "utf8");
  const styles = fs.readFileSync("app/training-polish.css", "utf8");
  assert.match(source, /className="modal programme-action-modal"/);
  assert.match(source, /className="programme-action-sheet"/);
  assert.match(source, /onClick=\{\(\) => setSelectedProgramme\(option\)\}/);
  assert.match(source, /Use this programme/);
  assert.match(source, /!selectedProgramme\.isLegacy && selectedProgramme\.id !== active\.id/);
  assert.match(source, /Delete programme/);
  assert.match(styles, /\.programme-action-modal\s*\{[^}]*z-index:\s*30/);
  assert.match(styles, /\.programme-action-sheet\s*\{[^}]*max-height:\s*min\(76svh,\s*560px\)/);
  assert.match(styles, /\.programme-action-sheet\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(styles, /\.programme-action-sheet\s*\{[^}]*safe-area-inset-bottom/);
});

test("programme actions require explicit use and never expose delete for active or original programmes", () => {
  const source = fs.readFileSync("app/training/page.tsx", "utf8");
  assert.match(source, /setSelectedProgramme\(option\)/);
  assert.match(source, /setSelectedProgramme\(null\); void switchProgramme\(selectedProgramme\)/);
  assert.match(source, /!selectedProgramme\.isLegacy && selectedProgramme\.id !== active\.id/);
});
