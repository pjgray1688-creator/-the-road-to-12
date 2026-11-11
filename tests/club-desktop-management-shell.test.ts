import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { resolveClubCapabilities } from "../lib/club-capabilities";

const shell = readFileSync("components/club-desktop-shell.tsx", "utf8");
const styles = readFileSync("components/club-desktop-shell.module.css", "utf8");

test("desktop shell is capability-driven and does not expand role permissions", () => {
  for (const capability of ["finance", "memberships", "promotions", "suppliers", "staff", "venues", "reports", "services", "workReview"]) assert.match(shell, new RegExp(`access\\.${capability}`));
  assert.match(shell, /access\.management \?/);
  assert.match(shell, /const operationalRoles = new Set/);
  assert.equal(resolveClubCapabilities("owner").includes("staff.permissions_manage"), true);
  assert.equal(resolveClubCapabilities("gym_admin").includes("staff.permissions_manage"), true);
  assert.equal(resolveClubCapabilities("gym_staff").includes("staff.permissions_manage"), false);
  assert.equal(resolveClubCapabilities("trainer").includes("staff.permissions_manage"), false);
  for (const role of ["owner", "gym_admin"] as const) {
    const capabilities = resolveClubCapabilities(role);
    assert.equal(capabilities.includes("members.view"), true);
    assert.equal(capabilities.includes("finance.view"), true);
    assert.equal(capabilities.includes("memberships.manage"), true);
    assert.equal(capabilities.includes("commerce.pricing_manage"), true);
  }
  for (const role of ["gym_staff", "trainer"] as const) {
    const capabilities = resolveClubCapabilities(role);
    assert.equal(capabilities.includes("members.view"), true);
    assert.equal(capabilities.includes("finance.view"), false);
    assert.equal(capabilities.includes("memberships.manage"), false);
    assert.equal(capabilities.includes("staff.permissions_manage"), false);
  }
  assert.doesNotMatch(shell, /role === "owner" \? \[\s*\{ label: "Management/);
});

test("sidebar destinations use existing routes and organization-scoped links", () => {
  const expected = [
    "app/club/page.tsx", "app/club/members/page.tsx", "app/club/classes/page.tsx", "app/club/shop/page.tsx",
    "app/club/payments/page.tsx", "app/club/check-in/page.tsx", "app/club/more/page.tsx",
    "app/club/memberships/page.tsx", "app/club/promotions/page.tsx", "app/club/website-shop/page.tsx",
    "app/club/website-shop/orders/page.tsx", "app/club/shop/supplier-catalogue/page.tsx",
    "app/club/shop/supplier-orders/page.tsx", "app/club/staff/page.tsx", "app/club/locations/page.tsx",
    "app/club/work/review/page.tsx",
    "app/club/stations/page.tsx", "app/club/reports/page.tsx", "app/club/services/page.tsx",
  ];
  for (const path of expected) assert.equal(existsSync(path), true, `${path} must exist`);
  assert.match(shell, /const q = `\?org=/);
  assert.match(shell, /router\.push\(`\$\{pathname\}\?\$\{params\.toString\(\)\}`\)/);
  assert.doesNotMatch(shell, /\/club\/suppliers\?/);
});

test("desktop-only responsive shell preserves native and mobile navigation", () => {
  assert.match(styles, /@media \(min-width: 1100px\)/);
  assert.match(styles, /@media \(max-width: 1099px\)/);
  assert.match(styles, /club-desktop-mobile-identity/);
  assert.match(styles, /data-collapsed="true"/);
  assert.match(shell, /localStorage\.setItem\(SIDEBAR_STORAGE_KEY/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /data-r12-shell="club-ios"/);
});
