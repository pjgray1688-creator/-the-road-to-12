import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Products & Pricing has one management-sidebar destination and Website Shop has internal navigation", () => {
  const shell = readFileSync("components/club-desktop-shell.tsx", "utf8");
  const websiteShopNav = readFileSync("components/club-website-shop-nav.tsx", "utf8");
  assert.match(shell, /label: "Products & pricing", href: `\/club\/products\$\{q\}`/);
  assert.match(shell, /path\.startsWith\("\/club\/products"\)/);
  assert.match(websiteShopNav, /Products &amp; Pricing/);
  assert.match(websiteShopNav, /href=\{`\/club\/website-shop\/orders/);
});
