import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { searchExercises } from "../lib/exercise-library";

const read = (path: string) => readFileSync(path, "utf8");

test("common exercise intents rank the expected canonical exercise first", () => {
  const cases: Array<[string, string]> = [
    ["bench press", "flat-bench-press"],
    ["flat bench", "flat-bench-press"],
    ["squat", "back-squat"],
    ["deadlift", "conventional-deadlift"],
    ["RDL", "romanian-deadlift"],
    ["OHP", "barbell-overhead-press"],
  ];
  for (const [query, expected] of cases) assert.equal(searchExercises(query)[0]?.id, expected, query);
});

test("specialist exact matches outrank broad popular intents and empty search starts with popular work", () => {
  assert.equal(searchExercises("Sumo Deadlift")[0]?.id, "sumo-deadlift");
  assert.deepEqual(searchExercises("").slice(0, 5).map(item => item.id), ["flat-bench-press", "back-squat", "conventional-deadlift", "barbell-overhead-press", "romanian-deadlift"]);
  assert.ok(searchExercises("", { equipment: "kettlebell" }).every(item => item.equipmentRequired.includes("kettlebell")));
});

test("manual builder uses ranked shared search and protects edited work during navigation", () => {
  const editor = read("components/manual-programme-editor.tsx");
  const css = read("app/globals.css");
  assert.match(editor, /searchExercises\(query\)\.slice\(0, 12\)/);
  assert.match(editor, /aria-pressed=\{days\[selectedDay\]\?\.exerciseIds\.includes\(exercise\.id\) \?\? false\}/);
  assert.match(editor, /href="\/onboarding" onClick=\{confirmLeave\}/);
  assert.match(editor, /beforeunload/);
  assert.match(editor, /popstate/);
  assert.match(editor, /confirmBeforeNavigate=\{hasUnsavedWork\}/);
  assert.match(css, /\.manual-exercise-results\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.manual-exercise-results button strong\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /@media\(max-width:360px\)/);
});

test("training setup has safe mobile heading and truthful navigation destinations", () => {
  const setup = read("components/training-setup-choice.tsx");
  const css = read("app/globals.css");
  assert.match(setup, /href="\/"[^>]*>.*R12 Home/);
  assert.match(setup, /href="\/training">Open Training/);
  assert.doesNotMatch(setup, /Back to Training Home/);
  assert.match(css, /\.training-setup-page \.page-header h1\{[^}]*line-height:1\.12/);
  assert.match(css, /padding-top:calc\(24px \+ env\(safe-area-inset-top\)\)/);
});

test("Member Hub layout reuses the shared persistent five-destination app navigation only on Member Hub paths", () => {
  const nav = read("components/app-nav.tsx");
  const layout = read("app/member-hub/layout.tsx");
  assert.match(layout, /<AppNav \/>/);
  for (const [path, label] of [["/", "Home"], ["/training", "Training"], ["/member-hub/shop", "Shop"], ["/member-hub/classes", "Classes"], ["/account", "Account"]]) {
    assert.ok(nav.includes(`href: "${path}", label: "${label}"`));
  }
  assert.match(nav, /const memberHub = pathname\.startsWith\("\/member-hub"\)/);
  assert.match(nav, /memberHub \? memberItems/);
  assert.match(nav, /aria-current=\{selected \? "page" : undefined\}/);
});
