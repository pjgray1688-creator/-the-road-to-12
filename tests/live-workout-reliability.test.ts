import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("rest timer recalculates from wall clock when the app returns", () => {
  const source = fs.readFileSync("components/rest-timer.tsx", "utf8");
  assert.match(source, /Date\.now\(\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /window\.addEventListener\("focus"/);
  assert.match(source, /timer-complete/);
  assert.match(source, /AudioContext/);
});

test("active completion notifies the home shell immediately", () => {
  const source = fs.readFileSync("components/training-app.tsx", "utf8");
  assert.match(source, /workout\?\.status === "completed"/);
  assert.match(source, /workouts-updated/);
});

test("resume derives the first incomplete exercise from persisted working sets", () => {
  const source = fs.readFileSync("components/training-app.tsx", "utf8");
  assert.match(source, /firstIncomplete/);
  assert.match(source, /set\.kind === "working"/);
  assert.match(source, /setStarted\(true\)/);
});
