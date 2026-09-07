import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

test("Today passes its canonical resolved occurrence to the missed-session action", () => {
  const dashboard = fs.readFileSync("components/dashboard-foundation.tsx", "utf8");
  assert.match(dashboard, /<MissedSessionAction occurrence=\{todayOccurrence \?/);
  assert.match(dashboard, /\.\.\.todayOccurrence/);
});

test("Today missed-session eligibility is based on the canonical planned occurrence", () => {
  const action = fs.readFileSync("components/missed-session-action.tsx", "utf8");
  assert.match(action, /occurrenceStatus && occurrenceStatus !== "planned"/);
  assert.match(action, /today\.session\.status === "rest"/);
  assert.match(action, /loadActiveWorkout\(\)/);
  assert.match(action, /status: "missed"/);
});

test("Today gym shortcut is ordered directly after the greeting", () => {
  const dashboard = fs.readFileSync("components/dashboard-foundation.tsx", "utf8");
  const greeting = dashboard.indexOf('today-greeting');
  const gym = dashboard.indexOf('member-gym-shortcut');
  assert.ok(greeting >= 0 && gym > greeting);
  const styles = fs.readFileSync("app/training-polish.css", "utf8");
  assert.match(styles, /\.home-screen > \.member-gym-shortcut \{ order: 3; \}/);
});
