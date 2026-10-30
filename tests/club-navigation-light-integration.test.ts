import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Club web navigation has seven coherent operational groups with permission-aware administration", () => {
  const shell = read("components/club-shell.tsx");
  const context = read("lib/club-server-context.ts");
  for (const label of ["Overview", "Members", "Payments", "Shop", "Classes & PT", "Operations", "Management"]) {
    assert.match(shell, new RegExp(`label: "${label}"`));
  }
  assert.match(shell, /paymentsAllowed \? \[\{ label: "Payments"/);
  assert.match(shell, /membersAllowed \? \[\{ label: "Members"/);
  assert.match(shell, /admin \? \[\{ label: "Management"/);
  assert.match(context, /hasCapability\(organisation\.id, userId, "members\.view"\)/);
  assert.match(context, /hasCapability\(organisation\.id, userId, "cash\.reconcile"\)/);
  assert.match(context, /navigation = \{ members: canViewMembers, payments:/);
});

test("Members opens the authorised existing directory instead of redirecting to Overview", () => {
  const members = read("app/club/members/page.tsx");
  assert.match(members, /resolveClubOperationalContext/);
  assert.match(members, /"members\.view"/);
  assert.match(members, /ClubMembersDirectory/);
  assert.match(members, /ClubMemberOnboarding/);
  assert.match(members, /payments\.extend_grace/);
  assert.doesNotMatch(members, /redirect\(`\/club/);
});

test("responsive Club web navigation is touch-friendly and does not compete with native Club tabs", () => {
  const styles = read("components/club-shell.module.css");
  assert.match(styles, /grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(max-width:1000px\) and \(min-width:701px\)/);
  assert.match(styles, /@media\(max-width:700px\)/);
  assert.match(styles, /min-height:44px/);
  assert.match(styles, /html\[data-r12-shell="club-ios"\].*\.primaryNavigation/);
  assert.match(styles, /\.primaryNavigation.*display:none!important/);
});

test("Payments, Shop and Management retain existing routes and logical secondary destinations", () => {
  const shell = read("components/club-shell.tsx");
  const payments = read("app/club/payments/page.tsx");
  const shopTabs = read("components/club-shop-tabs.tsx");
  const management = read("app/club/more/page.tsx");
  for (const route of ["/club/payments", "/club/reports", "/club/membership-billing", "/club/shop", "/club/products", "/club/promotions", "/club/more"]) {
    assert.match(`${shell}${payments}${shopTabs}${management}`, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(payments, /id="transactions"/);
  assert.match(payments, /id="attention"/);
  assert.match(payments, /id="cash"/);
  assert.doesNotMatch(payments, /club\/promotions/);
  assert.match(shopTabs, />Promotions</);
  assert.match(management, /title="Management"/);
});

test("Club light surfaces remain isolated from the dark Member Hub shop", () => {
  const staffShop = read("app/club/shop/page.tsx");
  const memberShop = read("app/member-hub/shop/page.tsx");
  const globals = read("app/globals.css");
  assert.match(staffShop, /loaded\.staff \? "module-page club-page club-shop-page"/);
  assert.match(globals, /\.club-shop-page \.staff-checkout \.club-family-sheet\{[^}]*background:#fff/);
  assert.match(memberShop, /member-shop-page/);
  assert.doesNotMatch(memberShop, /club-page/);
  assert.match(globals, /\.member-shop-page/);
  assert.match(globals, /\.club-family-sheet\{[^}]*background:#11161c/);
});
