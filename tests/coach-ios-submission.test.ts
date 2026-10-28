import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { playReviewerCoachRequestPolicy } from "../lib/play-reviewer";

const read = (path: string) => readFileSync(path, "utf8");

test("Coach native shell has one five-tab navigation with production destinations", () => {
  const app = read("ios/R12Coach/App/App.swift");
  const shell = read("ios/R12Coach/App/CoachNativeShell.swift");
  const project = read("ios/R12Coach/R12Coach.xcodeproj/project.pbxproj");
  assert.match(app, /CoachNativeShell\(\)/);
  assert.deepEqual(
    [...shell.matchAll(/CoachDestination\(title: "([^"]+)", path: "([^"]+)"/g)].map(match => [match[1], match[2]]),
    [["Clients", "/coach"], ["Diary", "/coach/diary"], ["Programmes", "/coach/programmes"], ["Nutrition", "/coach/nutrition"], ["Account", "/coach/account"]],
  );
  assert.match(shell, /\.toolbar\(\.hidden, for: \.navigationBar\)/);
  assert.match(shell, /safeAreaInset\(edge: \.bottom/);
  assert.match(shell, /websiteDataStore = \.default\(\)/);
  assert.doesNotMatch(shell, /R12 account|Open R12|toolbar.*reload|square\.and\.arrow\.up/);
  assert.doesNotMatch(project, /DEVELOPMENT_TEAM/);
  assert.match(project, /App\/PrivacyInfo\.xcprivacy/);
  assert.match(read("ios/R12Coach/App/PrivacyInfo.xcprivacy"), /NSPrivacyAccessedAPICategorySystemBootTime[\s\S]*35F9\.1/);
});

test("native-only presentation hides duplicate Coach web chrome without changing the web layout", () => {
  const shell = read("ios/R12Coach/App/CoachNativeShell.swift");
  assert.match(shell, /data-r12-coach-header/);
  assert.match(shell, /data-r12-coach-navigation/);
  assert.match(shell, /data-r12-coach-open-r12/);
  assert.match(read("components/coach-product-shell.tsx"), /data-r12-coach-header/);
  assert.match(read("components/coach-navigation.tsx"), /data-r12-coach-navigation/);
  const productShell = read("components/coach-product-shell.tsx");
  assert.match(productShell, /data-r12-coach-native-brand/);
  assert.match(read("components/coach-product-shell.module.css"), /html\[data-r12-shell="coach-ios"\].*\.nativeBrand/);
});

test("approved Coach emblem is installed unchanged in both native presentation assets", () => {
  const icon = readFileSync("ios/R12Coach/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png");
  const launch = readFileSync("ios/R12Coach/App/Assets.xcassets/LaunchLogo.imageset/LaunchLogo.png");
  const web = readFileSync("public/brand/r12-coach-emblem.png");
  const digest = (input: Buffer) => createHash("sha256").update(input).digest("hex");
  assert.equal(digest(icon), "b7fe83e23704882627482634ae12b98ab9b114ee5f0617bb93dbf8fe273b7125");
  assert.equal(digest(launch), digest(icon));
  assert.equal(digest(web), digest(icon));
  const storyboard = read("ios/R12Coach/App/LaunchScreen.storyboard");
  assert.match(storyboard, /image="LaunchLogo"/);
  assert.doesNotMatch(storyboard, /<label|R12 Coach|Clients, sessions/);
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
    assert.ok(source.indexOf("hasCoachReviewerEntitlement(user)") < source.indexOf(dataCall));
  }
  const demo = read("components/coach-reviewer-demo.tsx");
  assert.doesNotMatch(demo, /Coach demo destinations|const links|<Notice/);
  assert.doesNotMatch(demo, /CLIENTS · SYNTHETIC|COACH DIARY · SYNTHETIC|PROGRAMMES · SYNTHETIC|NUTRITION · SYNTHETIC/);
  assert.doesNotMatch(demo, />CLIENTS<\/span><h1|>COACH DIARY<\/span><h1|>PROGRAMMES<\/span><h1|>NUTRITION<\/span><h1|>COACH ACCOUNT<\/span><h1/);
  assert.match(demo, /Alex Taylor/);
  assert.match(read("lib/coach-reviewer-fixtures.ts"), /Foundation Strength/);
  assert.match(demo, /calories: 2600/);
  assert.match(demo, /Illustrative: 42 g protein/);
  assert.match(demo, /350 g raw \(about 280 g cooked\)/);
  assert.match(demo, /protein: 190/);
  assert.match(demo, /carbs: 290/);
  assert.match(demo, /fat: 75/);
  assert.match(demo, /sessionStorage/);
  assert.match(demo, /demoMode/);
  assert.match(demo, /About this App Review account/);
  assert.doesNotMatch(demo, /fetch\(|serverSupabase|\.rpc\(|stripe/i);
});

test("reviewer Coach workspace demonstrates multiple clients and isolated core workflows", () => {
  const fixtures = read("lib/coach-reviewer-fixtures.ts");
  for (const name of ["Alex Taylor", "Sophie Bennett", "Daniel Brooks", "Emma Clarke"]) assert.match(fixtures, new RegExp(name));
  const workspace = read("components/coach-reviewer-client-workspace.tsx");
  for (const label of ["Overview", "Workout History", "Progress / Measurements", "Programme", "Nutrition", "Sessions / Diary"]) assert.match(workspace, new RegExp(label));
  assert.match(workspace, /Start Workout/);
  assert.match(workspace, /Begin Session/);
  const workout = read("components/coach-reviewer-workout.tsx");
  assert.match(workout, /Load/);
  assert.match(workout, /Reps/);
  assert.match(workout, /RIR/);
  assert.match(workout, /Substitution/);
  assert.match(workout, /Left load/);
  assert.doesNotMatch(workout, /fetch\(/);
});

test("programme hierarchy and nutrition review mode preserve production boundaries", () => {
  const builder = read("components/coach-programme-builder.tsx");
  assert.match(builder, /TRAINING BLOCKS/);
  assert.match(builder, /Add a training block/);
  assert.match(builder, /BLOCK \{blockIndex \+ 1\}/);
  assert.doesNotMatch(builder, /Group exercises|Keep exercise identity separate/);
  const nutrition = read("components/coach-nutrition.tsx");
  assert.match(nutrition, /demoMode/);
  assert.match(nutrition, /Save plan/);
  assert.match(nutrition, /Assign to client/);
  assert.ok(nutrition.indexOf("if (demoMode)") < nutrition.indexOf('fetch("/api/coach/nutrition"'));
  const coachCss = read("components/coach-product-shell.module.css");
  assert.match(coachCss, /--coach-green/);
  assert.match(coachCss, /--lime:var\(--coach-green\)/);
  assert.doesNotMatch(coachCss, /rgba\(168,85,247|rgba\(155,77,255|#9b4dff|#8b69c4/i);
  assert.doesNotMatch(read("components/coach-navigation.module.css"), /rgba\(168,85,247|#9b4dff/i);
  assert.match(read("components/club-schedule-calendar.module.css"), /\.coachMode \.dateCell\.selected\{[^}]*#55ee7b/);
  assert.match(coachCss, /overflow-wrap:anywhere/);
});

test("reviewer programme editing uses the real builder without a network write", () => {
  const builder = read("components/coach-programme-builder.tsx");
  assert.match(builder, /demoMode\?: boolean/);
  assert.ok(builder.indexOf("if (demoMode)") < builder.indexOf('fetch("/api/coach/programme"'));
  assert.match(builder, /No production record was changed/);
  const demo = read("components/coach-reviewer-demo.tsx");
  assert.match(demo, /<CoachProgrammeBuilder/);
  assert.match(demo, /Assign and activate/);
});

test("review identity cannot call Coach APIs or mutate Coach routes", () => {
  const email = "appreview.staff@r12.live";
  assert.equal(playReviewerCoachRequestPolicy(email, "/api/coach/programmes", "GET"), "deny");
  assert.equal(playReviewerCoachRequestPolicy(email, "/coach/programmes", "POST"), "deny");
  assert.equal(playReviewerCoachRequestPolicy(email, "/coach/nutrition", "GET"), "allow");
  assert.equal(playReviewerCoachRequestPolicy("coach@example.com", "/api/coach/programmes", "POST"), "allow");
  assert.equal(playReviewerCoachRequestPolicy("staff@r12.live", "/api/coach/programmes", "POST"), "allow");
  const proxy = read("proxy.ts");
  assert.match(proxy, /playReviewerCoachRequestPolicy/);
  assert.match(proxy, /"\/coach\/:path\*", "\/api\/coach\/:path\*"/);
});
