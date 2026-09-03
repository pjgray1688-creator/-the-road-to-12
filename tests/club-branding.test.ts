import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clubTitle } from "../lib/club-metadata";

test("Club has an independent install identity without changing the Member manifest", () => {
  const clubManifest = readFileSync(new URL("../app/club/manifest.ts", import.meta.url), "utf8");
  const memberManifest = readFileSync(new URL("../app/manifest.ts", import.meta.url), "utf8");
  assert.match(clubManifest, /R12 Club/); assert.match(clubManifest, /club-icon-192/); assert.match(clubManifest, /start_url: "\/club"/);
  assert.match(memberManifest, /start_url: "\/"/); assert.doesNotMatch(memberManifest, /club-icon/);
});

test("Club title architecture is generic and tenant-safe", () => {
  const layout = readFileSync(new URL("../app/club/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /R12 Club/); assert.doesNotMatch(layout, /Madhouse/);
});

test("Club tenant title helper uses the multiplication mark", () => {
  assert.equal(clubTitle("Shop", "Madhouse Gym"), "Shop · R12 × Madhouse Gym");
  assert.equal(clubTitle(), "R12 Club");
});
