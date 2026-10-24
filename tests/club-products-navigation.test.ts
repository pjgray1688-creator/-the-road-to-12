import test from "node:test";
import { activeClubNavigationPath } from "../lib/club-navigation";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Products & Pricing is reached from the management Shop tabs", () => {
  const shell = readFileSync("components/club-shell.tsx", "utf8");
  const tabs = readFileSync("components/club-shop-tabs.tsx", "utf8");
  assert.doesNotMatch(shell, /\[\"Products & Pricing\"/);
  assert.match(tabs, /Products &amp; Pricing/);
  assert.equal(activeClubNavigationPath("/club/products"), "/club/shop");
});
