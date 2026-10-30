import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Club navigation exposes six coherent groups and capability-aware Management", () => {
  const shell = read("components/club-shell.tsx"); const context = read("lib/club-server-context.ts");
  for (const label of ["Overview", "Members", "Shop", "Classes & PT", "Daily Operations", "Management"]) assert.match(shell, new RegExp(`label: "${label}"`));
  assert.doesNotMatch(shell, /label: "Payments"/);
  assert.match(shell, /managementAllowed/);
  for (const capability of ["finance.view", "memberships.manage", "commerce.pricing_manage", "supplier.catalogue_manage", "staff.permissions_manage", "services.manage"]) assert.match(context, new RegExp(capability.replace(".", "\\.")));
  assert.match(shell, /Finance & reconciliation/);
  assert.match(shell, /Membership administration/);
  assert.match(shell, /Promotions & pricing/);
  assert.match(shell, /Suppliers & purchasing/);
  assert.match(shell, /Staff & permissions/);
  assert.match(shell, /Venues & settings/);
  assert.match(shell, /Reports & audit/);
  assert.match(shell, /Services & configuration/);
});

test("station compatibility route resolves to the working shared-station experience", () => {
  assert.match(read("app/club/station/page.tsx"), /redirect\("\/club\/lock"\)/);
  assert.match(read("app/club/check-in/page.tsx"), /redirect\("\/club\/station"\)/);
});

test("member creation requires email and exposes production products through authoritative workflow", () => {
  const component = read("components/club-member-onboarding.tsx"); const action = read("app/club/members/actions.ts");
  assert.match(component, /<label>Email<input required type="email"/);
  assert.match(component, /membershipProducts\(products, canAssign, false\)/);
  assert.doesNotMatch(component, /requiresMadhouseProviderCheckout/);
  assert.match(component, /initiateMembershipCounterPaymentAction/);
  assert.match(action, /A valid email is required for a new member/);
  assert.match(action, /Family Membership requires authorised negotiated contract terms/);
});

test("Club light surfaces remain isolated from the dark Member Hub shop", () => {
  const staffShop = read("app/club/shop/page.tsx"); const memberShop = read("app/member-hub/shop/page.tsx"); const globals = read("app/globals.css");
  assert.match(staffShop, /loaded\.staff \? "module-page club-page club-shop-page"/);
  assert.match(memberShop, /member-shop-page/); assert.doesNotMatch(memberShop, /club-page/);
  assert.match(globals, /\.member-shop-page/);
});
