import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { defaultTrainingProfile } from "../lib/training-profile";
import { generateTrainingProgramme } from "../lib/programme-generator";

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
