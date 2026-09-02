import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("landing auth actions preserve distinct signup and sign-in intent", () => {
  const source = fs.readFileSync("components/authenticated-home.tsx", "utf8");
  assert.match(source, /href="\/account\?mode=signUp"/);
  assert.match(source, /href="\/account\?mode=signIn"/);
});

test("onboarding owns immutable, question-specific choices and safe navigation", () => {
  const source = fs.readFileSync("app/onboarding/page.tsx", "utf8");
  assert.match(source, /as const/);
  assert.match(source, /key=\{`\$\{question\[0\]\}-\$\{String\(value\)\}`\}/);
  assert.match(source, /type="button" className="secondary"/);
  assert.match(source, /Conditioning means cardio or fitness work/);
  assert.match(source, /Would you like any extra conditioning\?/);
  assert.doesNotMatch(source, /question\[2\]\.push\(|question\[2\]\.unshift\(|question\[2\]\.splice\(/);
});

test("authenticated entry gates incomplete users into onboarding before workout rendering", () => {
  const source = fs.readFileSync("components/home-shell.tsx", "utf8");
  const workout = fs.readFileSync("components/training-app.tsx", "utf8");
  assert.match(source, /!result\?\.training_profile/);
  assert.match(source, /router\.replace\("\/onboarding"\)/);
  assert.match(workout, /!hasValidPlan && !resumeWorkout/);
});

test("preview and upcoming status rendering tolerate incomplete persisted records", () => {
  const preview = fs.readFileSync("app/training/preview/preview-client.tsx", "utf8");
  const dashboard = fs.readFileSync("components/dashboard-foundation.tsx", "utf8");
  assert.match(preview, /const status = occurrence\.status \?\? "planned"/);
  assert.match(dashboard, /day\.status \?\? "planned"/);
});
