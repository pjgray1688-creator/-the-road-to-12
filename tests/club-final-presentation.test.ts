import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const read = (path: string) => readFileSync(path, "utf8");
test("Club launch reuses the exact established Club artwork with a white aspect-fit image and no copy", () => {
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  // Native Club artwork introduced by 2d05bda; do not substitute the main R12 logo.
  const clubHash = "b05e3c68caadca9fd8a3b97ca58eede30348b3f1f1ad7c718262fa12ea15b85c";
  assert.equal(hash("ios/R12Club/App/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"), clubHash);
  assert.equal(hash("ios/R12Club/App/Assets.xcassets/LaunchLogo.imageset/logo.png"), clubHash);
  const xml = read("ios/R12Club/App/LaunchScreen.storyboard");
  assert.match(xml, /contentMode="scaleAspectFit" image="LaunchLogo"/);
  assert.match(xml, /backgroundColor" red="1" green="1" blue="1"/);
  assert.doesNotMatch(xml, /<label/);
});
test("local presentation is compiled out of Release and device builds, with no production toggle", () => {
  const source = read("ios/R12Club/App/ClubNativeShell.swift");
  assert.match(source, /#if DEBUG && targetEnvironment\(simulator\)\s*return ProcessInfo.processInfo.environment\["R12_CLUB_SCREENSHOTS"\] == "1"\s*#else\s*return false/);
  assert.match(source, /if screenshots \{ return url.scheme == "http" && url.host == "127.0.0.1" && url.port == 3121 \}/);
  assert.match(source, /else if ClubPresentation.screenshots \{ decisionHandler\(\.cancel\) \}/);
  assert.match(source, /!ClubPresentation.screenshots, url.scheme == "r12-club"/);
  assert.match(source, /\.nonPersistent\(\) : \.default\(\)/);
  assert.doesNotMatch(read("ios/R12Club/App/Info.plist"), /NSAllowsLocalNetworking/);
  assert.match(read("ios/R12Club/R12Club.xcodeproj/project.pbxproj"), /INFOPLIST_FILE = App\/Info-Debug.plist/);
  assert.doesNotMatch(read("app/club/layout.tsx"), /Demoer/);
});
test("native root pages have no title/options toolbar and only nested routes reserve a back row", () => {
  const source = read("ios/R12Club/App/ClubNativeShell.swift");
  assert.match(source, /toolbar\(\.hidden, for: \.navigationBar\)/);
  assert.match(source, /state.canGoBack && state.nestedRoute/);
  assert.doesNotMatch(source, /navigationTitle\(|Page options/);
  assert.match(source, /safeAreaInset\(edge: \.bottom/);
});
