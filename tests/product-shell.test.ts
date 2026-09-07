import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("root destinations share the persistent primary navigation", () => {
  const nav = fs.readFileSync("components/app-nav.tsx", "utf8");
  for (const href of ['href: "/"', 'href: "/training"', 'href: "/progress"', 'href: "/account"']) assert.match(nav, new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(fs.readFileSync("app/training-polish.css", "utf8"), /\.app-nav \{ position: fixed;/);
  assert.match(fs.readFileSync("app/training-polish.css", "utf8"), /padding-bottom: calc\(88px/);
});

test("Today uses an in-app check-in and keeps history destinations in Progress", () => {
  const dashboard = fs.readFileSync("components/dashboard-foundation.tsx", "utf8");
  const training = fs.readFileSync("app/training/page.tsx", "utf8");
  assert.match(dashboard, /DailyCheckInSheet/);
  assert.match(dashboard, /Save check-in/);
  assert.doesNotMatch(dashboard, /window\.prompt|window\.alert/);
  assert.doesNotMatch(dashboard, /Workout History|Personal Bests/);
  assert.doesNotMatch(training, /href="\/history"|href="\/personal-bests"/);
});

test("Account does not own programme destinations", () => {
  const account = fs.readFileSync("app/account/page.tsx", "utf8");
  assert.doesNotMatch(account, /Build my programme|Current programme|Training preferences/);
  assert.match(account, /PageHeader eyebrow="ACCOUNT"/);
});

test("programme progress uses the same completed-session snapshot on Today and Training", () => {
  const dashboard = fs.readFileSync("components/dashboard-foundation.tsx", "utf8");
  const training = fs.readFileSync("app/training/page.tsx", "utf8");
  assert.match(dashboard, /const completedInBlock = programmeSummary\.completedSessions/);
  assert.match(dashboard, /const programmeName = generated\?\.name \?\? legacy\.name/);
  assert.match(training, /const snapshot = programmeSnapshot\(active\.name/);
});
