import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { builderQuestions, questionOptions } from "../lib/onboarding-questions";

test("every onboarding question owns an independent immutable answer domain", () => {
  assert.equal(builderQuestions.length, 11);
  assert.deepEqual(builderQuestions.map(([key]) => key), ["availabilityMode", "goal", "experience", "daysPerWeek", "sessionMinutes", "environment", "priorities", "wantedExercises", "avoidedExercises", "conditioningPreference", "includeCardio"]);
  const availability = questionOptions(builderQuestions[0]);
  assert.ok(availability.some(([value]) => value === "flexible_week"));
  for (const question of builderQuestions.slice(1)) assert.equal(questionOptions(question).some(([, label]) => label === "Any days are fine"), false);
  const before = JSON.stringify(builderQuestions);
  questionOptions(builderQuestions[0]).push(["temporary", "Temporary"]);
  assert.equal(JSON.stringify(builderQuestions), before);
});

test("onboarding stores answers by field and renders canonical options on revisit", () => {
  const source = fs.readFileSync("app/onboarding/page.tsx", "utf8");
  assert.match(source, /const key = question\[0\]/);
  assert.match(source, /questionOptions\(question\)/);
  assert.match(source, /setStep\(step - 1\)/);
  assert.doesNotMatch(source, /questionOptions\(question\)\.(push|unshift|splice)/);
});

test("the existing missed-session action remains in the primary Today workout flow", () => {
  const workout = fs.readFileSync("components/training-app.tsx", "utf8");
  const training = fs.readFileSync("app/training/page.tsx", "utf8");
  const action = fs.readFileSync("components/missed-session-action.tsx", "utf8");
  assert.match(workout, /MissedSessionAction/);
  assert.match(training, /MissedSessionAction/);
  assert.match(action, /Mark this session as missed/);
  assert.match(action, /status: "missed"/);
  assert.doesNotMatch(action, /window\.(prompt|alert|confirm)/);
});
