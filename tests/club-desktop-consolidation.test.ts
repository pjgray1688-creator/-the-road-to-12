import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveClubCapabilities } from "../lib/club-capabilities";

const shell = readFileSync("components/club-desktop-shell.tsx", "utf8");
const shellCss = readFileSync("components/club-desktop-shell.module.css", "utf8");
const overview = readFileSync("app/club/page.tsx", "utf8");
const finance = readFileSync("app/club/payments/page.tsx", "utf8");
const classes = readFileSync("app/club/classes/page.tsx", "utf8");
const work = readFileSync("app/club/work/page.tsx", "utf8");
const workActions = readFileSync("app/club/work/actions.ts", "utf8");
const supplierOrders = readFileSync("app/club/shop/supplier-orders/page.tsx", "utf8");

test("operational Shop navigation stays available while catalogue administration remains under Management", () => {
  for (const label of ["Shop", "Stock", "Cash & till", "Balance top-up", "Supplier orders", "Collections", "Offers"]) assert.match(shell, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(shell, /access\.suppliers \? \[\{ label: "Supplier catalogue"/);
  assert.doesNotMatch(shell.slice(shell.indexOf("const shopNavigation"), shell.indexOf("const classesNavigation")), /Supplier catalogue/);
  assert.match(shell, /const shopRoutes = pathname\.startsWith\("\/club\/shop"\) && !pathname\.startsWith\("\/club\/shop\/supplier-catalogue"\)/);
  assert.match(shell, /shopRoutes && pathname === "\/club\/shop"/);
  assert.match(shell, /\["Shop Administration", "shop"\]/);
  assert.doesNotMatch(shell.slice(shell.indexOf("const shopNavigation"), shell.indexOf("const classesNavigation")), /Products & pricing|Supplier catalogue/);
  assert.match(shellCss, /operationalSubNavigation/);
  assert.match(shellCss, /@media \(min-width: 1100px\)/);
});

test("overview does not promote scanner use or duplicate member search and staff invitations", () => {
  assert.doesNotMatch(overview, /Open check-in|Pending Staff Invitations|Pending staff invitations/);
  assert.doesNotMatch(overview, /Find a member/);
  assert.match(shell, /pathname\.startsWith\("\/club\/members"\)/);
  assert.doesNotMatch(shell, /href: `\/club\/check-in\$\{q\}`/);
});

test("class setup and coach diary use existing authorised routes", () => {
  assert.match(classes, /showTypeLibrary=\{true\}/);
  assert.doesNotMatch(shellCss, /club-class-library[^}]*display:\s*none/);
  assert.match(classes, /coach_has_access/);
  assert.match(classes, /\/club\/classes\/diary/);
  const diary = readFileSync("app/club/classes/diary/page.tsx", "utf8");
  assert.match(diary, /ClubScheduleCalendar/);
  assert.match(diary, /club_list_shared_schedule/);
  assert.match(diary, /coach_has_access/);
  assert.match(diary, /canManageRota=\{false\}/);
  assert.match(shell, /label: "Rota & daily check setup"/);
  assert.doesNotMatch(classes, /club-class-tools-mobile[\s\S]*club\/classes\/setup/);
  assert.match(classes, /club-class-tools-desktop[\s\S]*PT diary/);
  const clubDiary = readFileSync("app/club/classes/diary/page.tsx", "utf8");
  const calendar = readFileSync("components/club-schedule-calendar.tsx", "utf8");
  const calendarCss = readFileSync("components/club-schedule-calendar.module.css", "utf8");
  assert.match(clubDiary, /coachMode clubMode/);
  assert.match(calendar, /clubMode \? "\/club\/classes\/diary"/);
  assert.match(calendarCss, /\.clubMode \.dateCell\.selected[^}]*#7544c5/);
});

test("finance separates completed sales and checkout attempts", () => {
  const tables = readFileSync("components/club-finance-transaction-tables.tsx", "utf8");
  assert.match(tables, /Completed transactions/);
  assert.match(tables, /Checkout attempts/);
  assert.match(tables, /PAGE_SIZE = 20/);
  assert.match(tables, /useMemo\(\(\) => rows\.filter/);
  assert.match(finance, /attemptsOnly \? "Checkout attempts" : "Finance & sales"/);
  assert.match(finance, /classifyReconciliationOrders/);
  assert.doesNotMatch(finance, /FAILED &amp; OVERDUE/);
});

test("operational and management destinations follow existing role capability fixtures", () => {
  for (const label of ["Overview", "Classes & PT", "Shop & Stock", "Daily Checks", "My Rota"]) assert.match(shell, new RegExp(`label: "${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  for (const role of ["gym_staff", "trainer"] as const) {
    const capabilities = resolveClubCapabilities(role);
    assert.equal(capabilities.includes("members.view"), true);
    assert.equal(capabilities.includes("finance.view"), false);
    assert.equal(capabilities.includes("memberships.manage"), false);
    assert.equal(capabilities.includes("commerce.pricing_manage"), false);
  }
  for (const role of ["owner", "gym_admin"] as const) {
    const capabilities = resolveClubCapabilities(role);
    assert.equal(capabilities.includes("finance.view"), true);
    assert.equal(capabilities.includes("memberships.manage"), true);
    assert.equal(capabilities.includes("commerce.pricing_manage"), true);
  }
  assert.match(shell, /access\.finance \? \[\{ label: "Finance & sales"/);
  assert.match(shell, /access\.memberships \? \[\{ label: "Membership administration"/);
});

test("work review uses the existing review capability in both query and mutation", () => {
  assert.match(work, /p_staff_user_id: user\.id/);
  assert.match(readFileSync("app/club/work/review/page.tsx", "utf8"), /hasCapability\(context\.organisation\.id, user\.id, "staff\.work_review"\)/);
  assert.match(readFileSync("app/club/work/review/page.tsx", "utf8"), /p_staff_user_id: null/);
  assert.match(workActions, /hasCapability\(context\.organisation\.id, user\.id, "staff\.work_review"\)/);
  assert.doesNotMatch(workActions, /!\["gym_admin", "owner"\]\.includes\(context\.role\)/);
});

test("supplier order states distinguish empty demand from unavailable setup and follow selected venue", () => {
  assert.match(supplierOrders, /No products are currently below their replenishment minimum/);
  assert.match(supplierOrders, /Paid available-to-order purchases will appear here when a supplier order is needed/);
  assert.match(supplierOrders, /Supplier order pipeline needs configuration/);
  assert.match(supplierOrders, /row\.location_id === activeLocation\.id/);
});
