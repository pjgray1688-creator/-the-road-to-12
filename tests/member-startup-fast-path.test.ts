import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("training storage hydration does not gate the authenticated app shell", () => {
  const boundary = read("components/training-storage-boundary.tsx");
  assert.match(boundary, /Promise\.allSettled\(\[loadProfile\(\), loadTrainingState\(\)\]\)/);
  assert.match(boundary, /<AssignedProgrammeContext\.Provider value=\{hasProgramme\}>[\s\S]*<TrainingProfileErrorContext\.Provider value=\{profileLoadFailed\}>\{children\}<\/TrainingProfileErrorContext\.Provider><\/AssignedProgrammeContext\.Provider>/);
  assert.doesNotMatch(boundary, /if \(state === "loading"\) return/);
  assert.doesNotMatch(boundary, /if \(state === "error"\) return/);
  assert.match(boundary, /event === "SIGNED_OUT"/);
});

test("Member home renders a shared branded shell while workout data loads and recovers from failure", () => {
  const home = read("components/home-shell.tsx");
  const training = read("app/training/page.tsx");
  const startup = read("components/member-startup-shell.tsx");
  assert.match(home, /<MemberStartupShell message="Getting your Member home ready…" \/>/);
  assert.match(home, /<MemberStartupShell message="Loading your training…" \/>/);
  assert.match(home, /onRetry=\{\(\) => \{ setServerResolved\(false\)/);
  assert.doesNotMatch(home, /if \(!resolved \|\| !serverResolved\) return/);
  assert.match(home, /void importLocalWorkouts\(\)\.then/);
  assert.ok(training.includes("<MemberStartupShell message=\"Getting your training ready…\" />"));
  assert.match(startup, /<BrandLockup compact \/>/);
  assert.match(startup, /<AppNav \/>/);
});

test("Gym Access keeps secure PIN/QR RPCs and eligibility checks without redundant return links", () => {
  const page = read("app/member-hub/access/page.tsx");
  const eligibility = read("components/member-access-venue-eligibility.tsx");
  assert.match(page, /club_list_my_memberships/);
  assert.match(page, /club_get_my_access_pass/);
  assert.match(page, /showMemberAreaReturn=\{false\}/);
  assert.doesNotMatch(page, /Back to Member Area/);
  assert.doesNotMatch(eligibility, /No door-controlled venues are currently available/);
  assert.match(eligibility, /club_get_my_access_eligibility/);
  assert.match(eligibility, /if \(!locations\.length\) return null/);
  assert.match(eligibility, /24-hour access eligibility/);
  assert.doesNotMatch(page, /Off.?Peak.*(?:10:00|15:00)/is);
});
