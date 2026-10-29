import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Club staff Shop is light without changing the Member Hub Shop scope", () => {
  const globals = read("../app/globals.css");
  const shop = read("../components/club-shop.module.css");
  const staffPage = read("../app/club/shop/page.tsx");
  const memberPage = read("../app/member-hub/shop/page.tsx");

  assert.match(staffPage, /className="module-page club-shop-page"/);
  assert.match(globals, /html:has\(\.club-shop-page\)/);
  assert.match(globals, /\.club-shop-page \.club-family-card\{[^}]*background:#fff/);
  assert.match(shop, /Staff Club Shop only\. Member Shop intentionally retains its dark presentation/);
  assert.match(shop, /:global\(\.club-shop-workspace\) \.product\{[^}]*background:#fff/);
  assert.doesNotMatch(shop, /:global\(\.member-shop-workspace\)[^{]*\{[^}]*background:#fff/);
  assert.match(memberPage, /member-shop-page/);
  assert.doesNotMatch(globals, /\.member-shop-page[^,{]*,[^{]*\.club-shop-page/);
});

test("Classes, Schedule and Finance use light Club-scoped surfaces", () => {
  const globals = read("../app/globals.css");
  const classes = read("../app/club/classes/classes.module.css");
  const schedule = read("../components/club-schedule-calendar.module.css");
  const scheduleExtra = read("../components/club-schedule-extra.module.css");

  assert.match(classes, /:global\(\.club-classes-page\) \.sessionCard\{[^}]*#fff/);
  assert.match(classes, /:global\(\.club-classes-page\) \.editorSheet\{[^}]*background:#fff/);
  assert.match(schedule, /\.workspace:not\(\.coachMode\)\{[^}]*#fff/);
  assert.match(schedule, /\.coachMode\{background:linear-gradient\(155deg,#142019,#101512/);
  assert.match(scheduleExtra, /Shared staff schedule/);
  assert.match(globals, /\.club-page:not\(\.glow-zone-page\) \.club-shop-tabs[^}]*background:#fff/);
});

test("Club operations header uses the approved emblem and keeps tenant identity", () => {
  const shell = read("../components/club-shell.tsx");
  const styles = read("../components/club-shell.module.css");

  assert.match(styles, /url\("\/brand\/r12-club-emblem\.png"\)/);
  assert.match(styles, /\.tenantMark>\*\{display:none\}/);
  assert.match(styles, /\.tenant>div \.eyebrow\{display:none\}/);
  assert.match(shell, /<strong>\{organisation\.name\}<\/strong>/);
  assert.match(shell, /Choose organisation/);
  assert.match(shell, /Choose operational venue/);
});
