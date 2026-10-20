import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clubTitle } from "../lib/club-metadata";

test("Club has an independent install identity without changing the Member manifest", () => {
  const clubManifestRoute = readFileSync(new URL("../app/club/manifest.webmanifest/route.ts", import.meta.url), "utf8");
  const androidApps = readFileSync(new URL("../lib/android-apps.ts", import.meta.url), "utf8");
  const memberManifest = readFileSync(new URL("../app/manifest.ts", import.meta.url), "utf8");
  assert.match(clubManifestRoute, /manifestResponse\("club"\)/);
  assert.match(androidApps, /club-icon-192\.png/); assert.match(androidApps, /startUrl: "\/club\/reception"/);
  assert.match(memberManifest, /start_url: "\/member-hub"/); assert.doesNotMatch(memberManifest, /club-icon/);
});

test("Club title architecture is generic and tenant-safe", () => {
  const layout = readFileSync(new URL("../app/club/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /R12 Club/); assert.doesNotMatch(layout, /Madhouse/);
});

test("Club tenant title helper uses the multiplication mark", () => {
  assert.equal(clubTitle("Shop", "Madhouse Gym"), "Shop · R12 × Madhouse Gym");
  assert.equal(clubTitle(), "R12 Club");
});
