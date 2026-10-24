import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Club bundles its required-reason declaration for measured navigation duration", () => {
  const source = readFileSync("ios/Shared/RouteWebScreen.swift", "utf8");
  const manifest = readFileSync("ios/R12Club/App/PrivacyInfo.xcprivacy", "utf8");
  const project = readFileSync("ios/R12Club/R12Club.xcodeproj/project.pbxproj", "utf8");
  assert.match(source, /ProcessInfo\.processInfo\.systemUptime/);
  assert.match(manifest, /NSPrivacyAccessedAPICategorySystemBootTime/);
  assert.match(manifest, /35F9\.1/);
  assert.match(project, /path = "App\/PrivacyInfo\.xcprivacy"/);
  assert.match(project, /PBXResourcesBuildPhase[^\n]*C10BAA001122334455667789/);
  assert.doesNotMatch(manifest, /NSPrivacyCollectedDataTypes/);
});

test("Club release remains build 1 with the established organisation signing and a valid dark launch", () => {
  const project = readFileSync("ios/R12Club/R12Club.xcodeproj/project.pbxproj", "utf8");
  assert.ok((project.match(/DEVELOPMENT_TEAM = 79ZP9U47SK/g) ?? []).length >= 2);
  assert.match(project, /CODE_SIGN_STYLE = Manual/);
  assert.match(project, /R12 Club App Store Distribution/);
  assert.match(project, /PRODUCT_BUNDLE_IDENTIFIER = live\.r12\.club/);
  const launch = readFileSync("ios/R12Club/App/LaunchScreen.storyboard", "utf8");
  for (const value of launch.matchAll(/(?:red|green|blue)="([^"]+)"/g)) {
    assert.ok(Number.isFinite(Number(value[1])) && Number(value[1]) >= 0 && Number(value[1]) <= 1);
  }
  const plist = readFileSync("ios/R12Club/App/Info.plist", "utf8");
  assert.match(plist, /CFBundleVersion<\/key>\s*<string>1<\/string>/);
  assert.match(plist, /CFBundleShortVersionString<\/key>\s*<string>1\.0\.0<\/string>/);
});
