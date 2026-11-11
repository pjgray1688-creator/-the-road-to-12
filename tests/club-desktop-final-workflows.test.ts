import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveClubCapabilities } from "../lib/club-capabilities";
import { classifyReconciliationOrders } from "../lib/club-reconciliation";

const read = (path: string) => readFileSync(path, "utf8");

test("desktop Overview starts with the five operational actions and omits management KPIs", () => {
  const page = read("app/club/page.tsx");
  const desktop = page.slice(page.indexOf("<section className={overviewStyles.desktopOverview}"));
  for (const action of ["My Shift", "Members", "Till", "Daily Checks"]) assert.match(desktop, new RegExp(action));
  const shiftActions = desktop.slice(desktop.indexOf("Shift actions"), desktop.indexOf("<div className={overviewStyles.mainGrid}"));
  assert.doesNotMatch(shiftActions, />Timetable</);
  assert.match(desktop, /Upcoming Classes &amp; PT[\s\S]*?>Timetable<\/Link>/);
  for (const removed of ["Active members", "Membership payments to review", "Cash declarations", "Membership mix"]) assert.doesNotMatch(desktop.toLowerCase(), new RegExp(removed.toLowerCase()));
  assert.ok(desktop.indexOf("Shift actions") < desktop.indexOf("Upcoming Classes &amp; PT"));
  assert.match(desktop, /resolveInstructorName\(session\.hostUserId, memberIdentities, session\.instructorName\)/);
  assert.match(page, /upcomingSessions\.slice\(0, 6\)/);
  assert.match(desktop, /Operational alerts/);
});

test("existing capabilities gate finance, management, supplier administration and work approvals", () => {
  const shell = read("components/club-desktop-shell.tsx");
  const context = read("lib/club-server-context.ts");
  assert.match(shell, /access\.finance \? \[\{ label: "Finance & sales"/);
  assert.match(shell, /access\.suppliers \? \[\{ label: "Supplier Catalogue"/);
  assert.match(shell, /access\.workReview \? \[\{ label: "Work submissions"/);
  assert.match(context, /hasCapability\(organisation\.id, userId, "staff\.work_review"\)/);
  assert.equal(resolveClubCapabilities("gym_staff").includes("finance.view"), false);
  assert.equal(resolveClubCapabilities("owner").includes("finance.view"), true);
});

test("home gym edits reuse the guarded organisation RPC and never grant access", () => {
  const action = read("app/club/members/[userId]/actions.ts");
  const component = read("components/club-member-home-gym-control.tsx");
  assert.match(action, /memberships\.assign/);
  assert.match(action, /item\.id === input\.locationId && item\.active/);
  assert.match(action, /setMemberHomeLocation\(context\.organisation\.id, input\.userId, location\.id\)/);
  assert.match(component, /Membership access is unchanged/);
  assert.doesNotMatch(action, /entitlement|club_memberships/);
});

test("staff work page lists only personal history and management review remains guarded", () => {
  const personal = read("app/club/work/page.tsx");
  const review = read("app/club/work/review/page.tsx");
  assert.match(personal, /p_staff_user_id: user\.id/);
  assert.doesNotMatch(personal, /Team work review|Approve/);
  assert.match(review, /staff\.work_review/);
  assert.match(review, /p_staff_user_id: null/);
});

test("stock rows distinguish missing venue records without showing a fabricated zero", () => {
  const stock = read("components/club-stock-panel.tsx");
  assert.match(stock, /locations\.filter\(location=>location\.active/);
  assert.match(stock, /No stock record/);
  assert.doesNotMatch(stock, /<b>0<\/b><small>\$\{location\.name\} · 0 available/);
});

test("finance classification keeps unpaid attempts out of sales", () => {
  const orders = ["paid", "fulfilled", "refunded", "draft", "pending_payment", "cancelled", "failed"].map((status, index) => ({ id: String(index), status }));
  const result = classifyReconciliationOrders(orders);
  assert.deepEqual(result.sales.map(order => order.status), ["paid", "fulfilled", "refunded"]);
  assert.deepEqual(result.attempts.map(order => order.status), ["draft", "pending_payment", "cancelled", "failed"]);
  const finance = read("app/club/payments/page.tsx");
  assert.match(finance, /showAttempts=\{attemptsOnly\}/);
  assert.doesNotMatch(finance, /CASH VERIFICATION|Cash collections/);
});
