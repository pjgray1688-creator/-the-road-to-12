import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveCheckVenue } from "../lib/club-check-access";
import { filterRotaStaff, resolveRotaScope } from "../lib/club-rota-scope";
import { displayClassTitle } from "../lib/club-class-presentation";
import { resolveInstructorName } from "../lib/club-instructor-name";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("operational check venue selection requires active server-authorized locations", () => {
  const locations = [{ id: "roth", active: true }, { id: "carlton", active: true }, { id: "closed", active: false }];
  const result = resolveCheckVenue({ locations, authorizedLocationIds: new Set(["carlton"]), canReview: false, requestedLocationId: "roth", scheduledLocationId: "roth" });
  assert.deepEqual(result.allowedLocations.map(location => location.id), ["carlton"]);
  assert.equal(result.locationId, "carlton", "rota/request query cannot override venue authorization");
  assert.equal(resolveCheckVenue({ locations, authorizedLocationIds: new Set(), canReview: false }).locationId, undefined);
  assert.deepEqual(resolveCheckVenue({ locations, authorizedLocationIds: new Set(), canReview: true }).allowedLocations.map(location => location.id), ["roth", "carlton"]);
});

test("daily checklist submission uses submit permission without requiring review permission", () => {
  const page = read("app/club/checks/page.tsx");
  const action = read("app/club/checks/actions.ts");
  const rpc = read("supabase/migrations/2026-11-20-club-venue-checks-maintenance.sql");
  assert.match(page, /hasCapability\(context\.organisation\.id, user\.id, "staff\.work_submit"\)/);
  assert.match(page, /club_location_authorized/);
  assert.match(action, /club_record_checklist_item/);
  assert.match(rpc, /club_venue_check_access\(p_organisation_id,p_location_id,'staff\.work_submit'\)/);
  assert.match(rpc, /club_venue_check_access\(p_organisation_id,p_location_id,'staff\.work_review'\)/);
});

test("rota scope gives team controls only to owner and gym admin", () => {
  assert.equal(resolveRotaScope("gym_staff", "team"), "mine");
  assert.equal(resolveRotaScope("trainer", "team"), "mine");
  assert.equal(resolveRotaScope("owner", "team"), "team");
  assert.equal(resolveRotaScope("gym_admin", undefined), "mine");
  const staff = [{ userId: "u1" }, { userId: "u2" }];
  assert.deepEqual(filterRotaStaff(staff, "mine", "u1"), [staff[0]]);
  assert.deepEqual(filterRotaStaff(staff, "team", "u1"), staff);
  assert.match(read("app/club/schedule/page.tsx"), /p_staff_user_id: scope === "team" \? null : user\.id/);
  assert.match(read("app/club/schedule/page.tsx"), /club_list_rota_staff/);
});

test("desktop and mobile navigation expose management destinations only through existing capabilities", () => {
  const shell = read("components/club-desktop-shell.tsx");
  const context = read("lib/club-server-context.ts");
  assert.match(shell, /access\.members \? \[\{ label: "Members"/);
  assert.match(shell, /label: "Staff Operations", href: `\/club\/staff-operations/);
  assert.match(shell, /access\.dailyChecks \? \[\{ label: "Daily Checks"/);
  assert.match(shell, /access\.finance \? \[\{ label: "Finance & sales"/);
  assert.match(shell, /access\.staff \? \[\{ label: "Staff & permissions"/);
  assert.match(shell, /access\.glowZone \? \[\{ label: "Glow Zone"/);
  assert.match(shell, /!mobileOpen && access\.management/);
  assert.match(context, /"staff\.work_review"/);
  assert.match(context, /dailyChecks: workSubmit \|\| workReview/);
  assert.match(context, /management: finance \|\| cashControls[\s\S]*workReview \}/);
  assert.doesNotMatch(context, /management: [^\n]*\|\| services/);
  const mobileBlock = shell.slice(shell.indexOf("const mobileNavigation"), shell.indexOf("const isGroupOpen"));
  assert.match(mobileBlock, /Staff Operations/);
  assert.match(mobileBlock, /Shop & Stock/);
  assert.doesNotMatch(mobileBlock, /label: "My Rota"/);
  assert.doesNotMatch(mobileBlock, /Glow Zone|Door access|Check-in station|Member imports|Supplier catalogue/);
  const mobileRender = shell.slice(shell.indexOf("{mobileOpen ? <>"), shell.indexOf("</> : links.map"));
  assert.match(mobileRender, /access\.management \? <div className=\{styles\.managementGroup\}/);
  assert.match(mobileRender, /club-mobile-management-links/);
  assert.match(mobileRender, /managementCategoryRoutes\.map/);
  assert.match(mobileRender, /shopNavigation, \(\) => setMobileOpenPath\(null\)/);
  for (const label of ["Finance & Payments", "Staff & Rota", "Membership Administration", "Shop Administration", "Venues & Settings"]) {
    assert.ok(shell.includes(`"${label}"`), `management destination exists: ${label}`);
  }
  assert.match(shell, /managementCategoryRoutes = \[/);
  assert.match(context, /management: finance \|\| cashControls[\s\S]*workReview \}/);
  const css = read("components/club-desktop-shell.module.css");
  assert.match(css, /@media \(max-width: 1099px\)[\s\S]*?\.managementGroup > button/);
  assert.match(css, /\.subNavigation > a:focus-visible/);
  assert.match(shell, /access\.stationAdmin \? \[\{ label: "Shared stations"/);
  assert.match(shell, /access\.doorAccess \? \[\{ label: "Door access administration"/);
  assert.match(shell, /pathname\.startsWith\("\/club\/shop\/supplier-catalogue"\)/);
  assert.match(css, /@media \(max-width: 1099px\)/);
  assert.match(css, /env\(safe-area-inset-top\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test("mobile manager routes and everyday Shop destinations remain reachable without changing capability gates", () => {
  const shell = read("components/club-desktop-shell.tsx");
  for (const route of ["/club/payments", "/club/membership-billing", "/club/staff", "/club/promotions", "/club/products", "/club/classes/setup"]) {
    assert.ok(shell.includes(route), `manager route exists: ${route}`);
  }
  for (const route of ["view=sell", "view=stock", "view=cash", "view=offers", "/club/shop/supplier-orders", "/club/shop/collections"]) {
    assert.ok(shell.includes(route), `Shop destination exists: ${route}`);
  }
  assert.match(shell, /access\.management \? <div className=\{styles\.managementGroup\}/);
  assert.match(shell, /access\.cashTill \? \[\{ label: "Cash & till"/);
  assert.match(shell, /access\.staff \? \[\{ label: "Staff & permissions"/);
});

test("member assignment form has an explicit open action and Till log has no current-page link", () => {
  const onboarding = read("components/club-member-onboarding.tsx");
  const shop = read("app/club/shop/page.tsx");
  assert.match(onboarding, /Add or assign a membership/);
  assert.match(onboarding, /Open membership form/);
  assert.match(onboarding, /aria-expanded=\{open\}/);
  assert.match(onboarding, /Find membership customer/);
  assert.doesNotMatch(shop, /club-till-subnav|href=\{`\$\{tillQuery\}&till=log`\}/);
  assert.match(shop, /<ClubRecentSales organisationId=/);
  const tabs = read("components/club-shop-tabs.tsx");
  assert.match(tabs, />Shop</);
  const stock = read("components/club-stock-panel.tsx");
  const shellCss = read("components/club-desktop-shell.module.css");
  assert.match(stock, /aria-label="Stock view"/);
  assert.match(stock, />Local stock</);
  assert.match(stock, />Full catalogue</);
  assert.match(shellCss, /stock-view-toggle button\.active\) \{ border-color:#633582; background:#75429b; color:#fff; \}/);
  assert.match(shellCss, /stock-view-toggle button\) \{ flex:1; min-height:38px/);
});

test("staff Offers view shows both existing offer sources while management editing stays capability-gated", () => {
  const shop = read("app/club/shop/page.tsx");
  const promotions = read("app/club/promotions/page.tsx");
  assert.match(shop, /from\("club_promotions"\)/);
  assert.match(shop, /from\("club_membership_joining_fee_promotions"\)/);
  assert.match(promotions, /hasCapability\(context\.organisation\.id,user\.id,"commerce\.pricing_manage"\)/);
  assert.match(promotions, /<ClubPromotions/);
});

test("class titles and instructors use current linked identities", () => {
  assert.equal(displayClassTitle("Women Only", "Girls and Gains"), "Girls and Gains");
  assert.equal(displayClassTitle("Circuit", "Circuit"), "Circuit");
  assert.equal(resolveInstructorName("u1", null, [{ userId: "u1", displayName: "Luke Morris" }], "Luke"), "Luke Morris");
  assert.equal(resolveInstructorName("u2", null, [{ userId: "u1", displayName: "Luke Morris" }], "Luke"), "Instructor name unavailable");
  assert.match(read("app/club/page.tsx"), /resolveInstructorName\(session\.hostUserId/);
  assert.match(read("app/club/classes/page.tsx"), /resolveInstructorName\(session\.hostUserId/);
  assert.match(read("lib/club-instructor-name.ts"), /club_list_member_identities/);
  assert.match(read("lib/club-instructor-name.ts"), /club_list_class_instructor_identities/);
  assert.doesNotMatch(read("app/club/classes/setup/page.tsx"), /showTypeLibrary=\{true\}/);
  assert.doesNotMatch(read("components/club-desktop-shell.module.css"), /club-main-timetable \.club-class-library\)/);
});

test("Shop view data dependencies avoid loading the supplier catalogue for till, stock-independent and offers views", () => {
  const page = read("app/club/shop/page.tsx");
  assert.match(page, /catalogueView \? client\.rpc\("club_list_member_supplier_catalogue"/);
  assert.match(page, /staff && view === "stock" \? repository\.listInventoryReceipts/);
  assert.match(page, /staff && view === "sell" \? repository\.listCustomers/);
  assert.match(page, /view === "sell" \? client\.from\("club_promotions"/);
  assert.match(page, /!staff && view === "sell" \? repository\.listOrders/);
});
