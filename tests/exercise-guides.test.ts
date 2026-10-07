import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { exerciseGuideManifest, getExerciseGuide, hasExerciseGuide, validateExerciseGuideManifest } from "../lib/exercise-guides";

test("exercise guide manifest is small, canonical, and valid", () => {
  const guides = exerciseGuideManifest();
  assert.equal(guides.length, 6);
  assert.deepEqual(validateExerciseGuideManifest(), []);
  assert.ok(guides.every(item => item.exerciseId === item.exerciseId.trim()));
});

test("guide lookup resolves canonical, alias, and legacy exercise IDs", () => {
  assert.equal(getExerciseGuide("back-squat")?.exerciseId, "back-squat");
  assert.equal(getExerciseGuide("rdl")?.exerciseId, "romanian-deadlift");
  assert.equal(hasExerciseGuide("romanian-deadlift"), true);
  assert.equal(getExerciseGuide("exercise-that-does-not-exist"), undefined);
});

test("written guides do not claim video assets and retain reviewed muscle regions", () => {
  const guide = getExerciseGuide("lat-pulldown");
  assert.equal(guide?.mediaStatus, "written");
  assert.equal(guide?.video, undefined);
  assert.ok(guide?.primaryMuscles.includes("lats"));
  assert.ok(guide?.formCues.length);
});

test("invalid guide entries are rejected by deterministic validation", () => {
  const invalid = [{ ...getExerciseGuide("back-squat"), exerciseId: "not-real", mediaStatus: "video", video: undefined }];
  const errors = validateExerciseGuideManifest(invalid);
  assert.ok(errors.some(error => error.includes("unknown exercise id")));
  assert.ok(errors.some(error => error.includes("video media requires")));
});

test("Member and Coach use the shared content-aware guide surface", () => {
  const training = fs.readFileSync("components/training-app.tsx", "utf8");
  const sheet = fs.readFileSync("components/exercise-guide-sheet.tsx", "utf8");
  const builder = fs.readFileSync("components/coach-programme-builder.tsx", "utf8");
  assert.match(training, /ExerciseGuideSheet/);
  assert.match(sheet, /getExerciseGuide/);
  assert.match(sheet, /preload="none"/);
  assert.match(builder, /builderSearch/);
});
