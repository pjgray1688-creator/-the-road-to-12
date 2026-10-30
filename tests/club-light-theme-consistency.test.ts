import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Club staff Shop is light without changing the Member Hub Shop scope", () => {
  const globals = read("../app/globals.css");
  const shop = read("../components/club-shop.module.css");
  const staffPage = read("../app/club/shop/page.tsx");
  const memberPage = read("../app/member-hub/shop/page.tsx");

  assert.match(staffPage, /loaded\.staff \? "module-page club-page club-shop-page" : "module-page club-shop-page"/);
  assert.match(globals, /html:has\(\.club-shop-page\)/);
  assert.match(globals, /\.club-shop-page \.club-family-card\{[^}]*background:#fff/);
  assert.match(globals, /\.club-shop-page \.staff-checkout \.club-family-sheet\{[^}]*background:#fff[^}]*color:#17131d/);
  assert.match(globals, /\.club-shop-page \.staff-checkout \.club-family-option\[aria-pressed=true\]\{[^}]*background:#eee3f8/);
  assert.match(shop, /Staff Club Shop only\. Member Shop intentionally retains its dark presentation/);
  assert.match(shop, /:global\(\.club-shop-workspace\) \.product\{[^}]*background:#fff/);
  assert.doesNotMatch(shop, /:global\(\.member-shop-workspace\)[^{]*\{[^}]*background:#fff/);
  assert.match(memberPage, /member-shop-page/);
  assert.doesNotMatch(memberPage, /className="[^"]*\bclub-page\b/);
  assert.match(globals, /\.club-family-sheet\{[^}]*background:#11161c[^}]*color:#fff/);
  assert.doesNotMatch(globals, /\.member-shop-page[^,{]*,[^{]*\.club-shop-page/);
});

test("Classes, Schedule and Finance use light Club-scoped surfaces", () => {
  const globals = read("../app/globals.css");
  const classes = read("../app/club/classes/classes.module.css");
  const schedule = read("../components/club-schedule-calendar.module.css");
  const scheduleExtra = read("../components/club-schedule-extra.module.css");
  const classesPage = read("../app/club/classes/page.tsx");
  const schedulePage = read("../app/club/schedule/page.tsx");
  const paymentsPage = read("../app/club/payments/page.tsx");

  assert.match(classes, /:global\(\.club-classes-page\) \.sessionCard\{[^}]*#fff/);
  assert.match(classes, /:global\(\.club-classes-page\) \.editorSheet\{[^}]*background:#fff/);
  assert.match(schedule, /\.workspace:not\(\.coachMode\)\{[^}]*#fff/);
  assert.match(schedule, /\.coachMode\{background:linear-gradient\(155deg,#142019,#101512/);
  assert.match(scheduleExtra, /Shared staff schedule/);
  assert.match(globals, /\.club-page:not\(\.glow-zone-page\) \.club-shop-tabs[^}]*background:#fff/);
  assert.match(classesPage, /module-page club-page club-classes-page/);
  assert.match(schedulePage, /module-page club-page/);
  assert.match(paymentsPage, /module-page club-page/);
});

test("Club operations header uses the approved emblem and keeps tenant identity", () => {
  const shell = read("../components/club-shell.tsx");
  const styles = read("../components/club-shell.module.css");

  assert.match(styles, /url\("\/brand\/r12-club-emblem\.png"\)/);
  assert.match(shell, /<span aria-hidden="true" className=\{styles\.tenantMark\} \/>/);
  assert.doesNotMatch(shell, /BrandLockup/);
  assert.match(styles, /\.tenant>div \.eyebrow\{display:none\}/);
  assert.match(shell, /<strong>\{organisation\.name\}<\/strong>/);
  assert.match(shell, /Choose organisation/);
  assert.match(shell, /Choose operational venue/);
});
