import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { playReviewerCoachRequestPolicy } from "../lib/play-reviewer";

const read = (path: string) => readFileSync(path, "utf8");

test("native Coach markers suppress duplicate chrome only when the native shell opts in", () => {
  const shell = read("components/coach-product-shell.tsx");
  assert.match(shell, /data-r12-coach-shell/);
  assert.match(shell, /data-r12-coach-header/);
  assert.match(shell, /data-r12-coach-native-brand/);
  assert.match(read("components/coach-navigation.tsx"), /data-r12-coach-navigation/);
  assert.match(read("components/coach-product-shell.module.css"), /html\[data-r12-shell="coach-ios"\].*\.nativeBrand/);
  const digest = createHash("sha256").update(readFileSync("public/brand/r12-coach-emblem.png")).digest("hex");
  assert.equal(digest, "b7fe83e23704882627482634ae12b98ab9b114ee5f0617bb93dbf8fe273b7125");
});

test("confirmed reviewer receives synthetic Coach pages before production data calls", () => {
  const routes: Array<[string, string, string]> = [
    ["app/coach/page.tsx", "clients", 'rpc("coach_list_clients")'],
    ["app/coach/diary/page.tsx", "diary", 'rpc("coach_has_access"'],
    ["app/coach/programmes/page.tsx", "programmes", 'rpc("coach_has_access"'],
    ["app/coach/nutrition/page.tsx", "nutrition", 'rpc("coach_has_access"'],
    ["app/coach/account/page.tsx", "account", 'rpc("coach_has_access"'],
  ];
  for (const [path, screen, dataCall] of routes) {
    const source = read(path);
    assert.match(source, new RegExp(`CoachReviewerDemo screen="${screen}"`));
    assert.ok(source.indexOf("hasPlayReviewerEntitlement(user)") < source.indexOf(dataCall));
  }
  const demo = read("components/coach-reviewer-demo.tsx");
  assert.doesNotMatch(demo, /Coach demo destinations|const links|<Notice/);
  assert.match(demo, /Alex Taylor/);
  assert.match(demo, /Foundation Strength/);
  assert.match(demo, /2,600/);
  assert.match(demo, /190 g/);
  assert.match(demo, /290 g/);
  assert.match(demo, /75 g/);
  assert.match(demo, /2,595 kcal/);
  assert.match(demo, /sessionStorage/);
  assert.match(demo, /demoMode/);
  assert.match(demo, /About this demonstration/);
  assert.doesNotMatch(demo, /fetch\(|serverSupabase|\.rpc\(|stripe/i);
});

test("reviewer programme editing uses the real builder without a network write", () => {
  const builder = read("components/coach-programme-builder.tsx");
  assert.match(builder, /demoMode\?: boolean/);
  assert.ok(builder.indexOf("if (demoMode)") < builder.indexOf('fetch("/api/coach/programme"'));
  assert.match(builder, /No member data changed/);
  const demo = read("components/coach-reviewer-demo.tsx");
  assert.match(demo, /<CoachProgrammeBuilder/);
  assert.match(demo, /Assign and activate/);
});

test("review identity cannot call Coach APIs or mutate Coach routes", () => {
  const email = "staff@r12.live";
  assert.equal(playReviewerCoachRequestPolicy(email, "/api/coach/programmes", "GET"), "deny");
  assert.equal(playReviewerCoachRequestPolicy(email, "/coach/programmes", "POST"), "deny");
  assert.equal(playReviewerCoachRequestPolicy(email, "/coach/nutrition", "GET"), "allow");
  assert.equal(playReviewerCoachRequestPolicy("coach@example.com", "/api/coach/programmes", "POST"), "allow");
  const proxy = read("proxy.ts");
  assert.match(proxy, /playReviewerCoachRequestPolicy/);
  assert.match(proxy, /"\/coach\/:path\*", "\/api\/coach\/:path\*"/);
});
