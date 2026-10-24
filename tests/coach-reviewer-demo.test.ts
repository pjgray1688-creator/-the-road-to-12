import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { playReviewerCoachRequestPolicy } from "../lib/play-reviewer";

const read = (path: string) => readFileSync(path, "utf8");

test("native Coach markers suppress duplicate chrome only when the native shell opts in", () => {
  assert.match(read("components/coach-product-shell.tsx"), /data-r12-coach-shell/);
  assert.match(read("components/coach-product-shell.tsx"), /data-r12-coach-header/);
  assert.match(read("components/coach-navigation.tsx"), /data-r12-coach-navigation/);
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
  assert.match(demo, /synthetic examples/);
  assert.match(demo, /Alex Taylor/);
  assert.match(demo, /Foundation Strength/);
  assert.match(demo, /Performance foundations/);
  assert.doesNotMatch(demo, /fetch\(|serverSupabase|\.rpc\(|stripe/i);
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
