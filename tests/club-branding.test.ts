import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clubTitle } from "../lib/club-metadata";

test("Club operations and member Android install identities remain separate", () => {
  const clubManifest = readFileSync(new URL("../app/club/manifest.ts", import.meta.url), "utf8");
  const memberManifest = readFileSync(new URL("../app/manifest.ts", import.meta.url), "utf8");
  const androidApps = readFileSync(new URL("../lib/android-apps.ts", import.meta.url), "utf8");
  assert.match(clubManifest, /R12 Club/); assert.match(clubManifest, /club-icon-192/); assert.match(clubManifest, /start_url: "\/club"/);
  assert.match(memberManifest, /webManifest\("r12"\)/); assert.doesNotMatch(memberManifest, /club-icon/);
  assert.match(androidApps, /startUrl:"\/member-hub"/); assert.match(androidApps, /manifestPath:"\/member-hub\/manifest\.webmanifest"/);
});

test("Club title architecture is generic and tenant-safe", () => {
  const layout = readFileSync(new URL("../app/club/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /R12 Club/); assert.doesNotMatch(layout, /Madhouse/);
});

test("Club tenant title helper uses the multiplication mark", () => {
  assert.equal(clubTitle("Shop", "Madhouse Gym"), "Shop · R12 × Madhouse Gym");
  assert.equal(clubTitle(), "R12 Club");
});
