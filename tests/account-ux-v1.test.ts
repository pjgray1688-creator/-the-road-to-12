import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("app/account/page.tsx", "utf8");

test("account presents consumer sections without backend or recovery jargon", () => {
  assert.match(source, /PROFILE/); assert.match(source, /TRAINING PROFILE/); assert.match(source, /CONNECTIONS/); assert.match(source, /SUPPORT/);
  assert.doesNotMatch(source, /canonical|rehydrate|reconcile|payload|migration|server workout|local workout/i);
  assert.doesNotMatch(source, /setMessage\(result\.error\.message\)/);
  assert.doesNotMatch(source, /account\.id/);
});

test("account keeps canonical training and progress entry points", () => {
  assert.match(source, /href="\/training"/); assert.match(source, /href="\/progress"/); assert.match(source, /href="\/onboarding"/); assert.match(source, /auth\.signOut/);
});

test("WHOOP status remains a concise consumer state", () => {
  assert.match(source, /Connected/); assert.match(source, /Not connected/); assert.match(source, /integrations\/whoop\/status/);
  assert.doesNotMatch(source, /access_token|refresh_token|webhook|raw API/i);
});
