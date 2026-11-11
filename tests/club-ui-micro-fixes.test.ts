import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const shell = read("../components/club-desktop-shell.tsx");
const shellCss = read("../components/club-desktop-shell.module.css");
const globalCss = read("../app/globals.css");
const classes = read("../components/club-classes.tsx");
const classesPage = read("../app/club/classes/page.tsx");
const shopPage = read("../app/club/shop/page.tsx");
const staffCheckout = read("../components/club-staff-checkout.tsx");
const diaryCss = read("../components/club-schedule-calendar.module.css");
const shop = read("../components/club-shop.tsx");
const shopCss = read("../components/club-shop.module.css");
const reportsPage = read("../app/club/classes/reports/page.tsx");

test("global member search has one outside label and submits to the existing members route", () => {
  assert.match(shell, /<label htmlFor="club-global-search">Search members<\/label><form[^>]+action="\/club\/members"/);
  assert.match(shell, /placeholder="Name or email…"/);
  assert.doesNotMatch(shell, /<Icon name="members" \/><span className=\{styles\.searchLabel\}/);
  assert.match(shellCss, /\.searchControl > label/);
  assert.match(shellCss, /\.search \{[^}]*min-width: 190px/);
  assert.match(shellCss, /\.control select \{ width: clamp\(166px, 13vw, 184px\); min-width: 166px; height: 38px/);
  assert.match(shellCss, /\.searchControl > label \{[^}]*font-size: 11px; font-weight: 700; line-height: 1/);
});

test("desktop Shop uses one Shop destination and the staff sell view has only Build a basket", () => {
  assert.match(shell, /\{ label: "Shop", href: `\/club\/shop/);
  assert.doesNotMatch(shell, /\{ label: "Sell", href:/);
  assert.match(shopPage, /const staffSellView = loaded\.staff && view === "sell"/);
  assert.match(shopPage, /\{!staffSellView \? <PageHeader/);
  assert.match(staffCheckout, /<h2>Build a basket<\/h2>/);
  assert.doesNotMatch(staffCheckout, /RECEPTION CHECKOUT/);
  assert.match(shellCss, /\.shopSellContent \{ padding-top: 12px; \}/);
});

test("reception checkout CTA has explicit purple, disabled, focus, hover and loading states", () => {
  assert.match(staffCheckout, /disabled=\{!lines\.length \|\| !pricingReady\}/);
  assert.match(staffCheckout, /aria-busy=\{pending\} onClick=\{submit\}/);
  assert.match(globalCss, /\.club-shop-page \.staff-checkout-basket \.primary\.full\{[^}]*background:#75429b;color:#fff/);
  assert.match(globalCss, /\.staff-checkout-basket \.primary\.full:hover:not\(:disabled\)/);
  assert.match(globalCss, /\.staff-checkout-basket \.primary\.full:focus-visible/);
  assert.match(globalCss, /\.staff-checkout-basket \.primary\.full:disabled\{[^}]*background:#e7e3ea;color:#625a68;opacity:1/);
  assert.match(globalCss, /\.staff-checkout-basket \.primary\.full\[aria-busy="true"\]/);
});

test("desktop Classes header, tools and timetable are grouped with reduced vertical spacing", () => {
  assert.match(shellCss, /\.content :global\(\.club-page\.club-main-timetable > \.page-header\) \{ min-height: 0; margin-bottom: 3px; \}/);
  assert.match(shellCss, /:global\(\.club-class-tools\) \{ display:flex; flex-wrap:wrap; gap:8px; margin-top:2px; \}/);
  assert.match(shellCss, /:global\(\.club-page\.club-main-timetable \.workspace\) \{ gap:10px; \}/);
});

test("classes timetable has a single Timetable heading without legacy copy or historical-count filler", () => {
  assert.match(classes, /<h2 className=\{styles\.timetableTitle\}>Timetable<\/h2>/);
  assert.match(classes, />Create Class</);
  assert.doesNotMatch(classes, /CLASS OPERATIONS|scheduled and historical sessions/);
  assert.match(classesPage, /canViewClassReports/);
});

test("Club PT diary keeps the selected weekday and date legible in white", () => {
  assert.match(diaryCss, /\.clubMode \.dateCell\.selected small,\.clubMode \.dateCell\.selected strong\{color:#fff\}/);
  assert.match(diaryCss, /\.coachMode \.dateCell\.selected\{[^}]*background:#207a3a/);
});

test("Shop checkout action has normal, hover, focus, disabled and loading presentation", () => {
  assert.equal((shop.match(/aria-busy=\{pending\}/g) ?? []).length, 2);
  assert.match(shopCss, /\.shopModal \.sheet>:global\(\.primary\.full\).*background:#75429b;color:#fff/);
  assert.match(shopCss, /primary\.full\):hover:not\(:disabled\)/);
  assert.match(shopCss, /primary\.full\):focus-visible/);
  assert.match(shopCss, /primary\.full\):disabled/);
  assert.match(shopCss, /primary\.full\)\[aria-busy="true"\]/);
});

test("class report navigation uses the same capability requirements as its server-guarded destination", () => {
  assert.match(classesPage, /hasCapability\(context\.organisation\.id, userId, "classes\.manage"\)/);
  assert.match(classesPage, /hasCapability\(context\.organisation\.id, userId, "payments\.record_cash"\)/);
  assert.match(classesPage, /hasCapability\(context\.organisation\.id, userId, "cash\.reconcile"\)/);
  assert.match(reportsPage, /if \(!canManageClasses \|\| \(!canRecordCash && !canReconcileCash\)\)/);
  assert.match(classesPage, /\{canViewClassReports \?/);
});
