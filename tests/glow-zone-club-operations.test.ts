import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { summarizeCompletedGlowSales } from "../lib/glow-zone-finance";

const migrationPath = new URL("../supabase/migrations/2027-01-24-glow-zone-carlton-operations-guards.sql", import.meta.url);
const componentPath = new URL("../components/glow-zone-reception-scanner.tsx", import.meta.url);
const actionsPath = new URL("../app/club/sunbeds/actions.ts", import.meta.url);
const shellPath = new URL("../components/club-desktop-shell.tsx", import.meta.url);
const layoutPath = new URL("../app/club/layout.tsx", import.meta.url);
const managementPath = new URL("../app/club/more/page.tsx", import.meta.url);
const pagePath = new URL("../app/club/sunbeds/page.tsx", import.meta.url);
const operationUiPath = new URL("../components/club-sunbed-operations.tsx", import.meta.url);
const financePagePath = new URL("../app/club/payments/page.tsx", import.meta.url);
const sessionMigrationPath = new URL("../supabase/migrations/2026-10-25-glow-zone-session-requests.sql", import.meta.url);

test("Glow Zone Finance totals count only completed sales within the selected date and venue", () => {
  const result = summarizeCompletedGlowSales([
    { amount_minor: 1500, location_id: "carlton", status: "completed", created_at: "2026-11-03T12:00:00Z" },
    { amount_minor: 800, location_id: "carlton", status: "pending", created_at: "2026-11-03T12:00:00Z" },
    { amount_minor: 900, location_id: "rotherham", status: "completed", created_at: "2026-11-03T12:00:00Z" },
    { amount_minor: 1000, location_id: "carlton", status: "cancelled", created_at: "2026-11-03T12:00:00Z" },
    { amount_minor: 2000, location_id: "carlton", status: "completed", created_at: "2026-11-04T00:00:00Z" },
  ], { from: "2026-11-03T00:00:00Z", to: "2026-11-03T23:59:59.999Z", locationId: "carlton" });
  assert.equal(result.amountMinor, 1500);
  assert.equal(result.count, 1);
  assert.equal(result.records[0]?.location_id, "carlton");
});

test("Glow Zone scan and confirmation preserve QR-only, single-use deductions", async () => {
  const [migration, scanner, actions] = await Promise.all([
    readFile(migrationPath, "utf8"), readFile(componentPath, "utf8"), readFile(actionsPath, "utf8"),
  ]);
  assert.match(migration, /club_glow_carlton_staff_allowed/);
  assert.match(migration, /r\.status='pending'/);
  assert.match(migration, /r\.expires_at>now\(\)/);
  assert.match(migration, /revoke all on function public\.club_glow_spend\([^;]+authenticated/s);
  assert.match(scanner, /confirmGlowSessionRequestAction/);
  assert.match(scanner, /minutes deducted once/);
  assert.doesNotMatch(scanner, /club_glow_spend|USE MINUTES/);
  assert.match(actions, /club_glow_scan_session_request/);
  assert.match(actions, /club_glow_confirm_session_request/);
  assert.match(actions, /locationId!==s\.locationId/);
});

test("invalid and expired requests and insufficient balances fail before credit deduction", async () => {
  const [migration, sessionMigration] = await Promise.all([readFile(migrationPath, "utf8"), readFile(sessionMigrationPath, "utf8")]);
  assert.match(migration, /r\.status='pending'/);
  assert.match(migration, /r\.expires_at>now\(\)/);
  assert.match(migration, /p_minutes<=0/);
  assert.match(migration, /if left_qty>0 then raise exception 'Insufficient Glow Zone minutes'/);
  assert.match(migration, /public\.club_glow_effective_age_status\(p_organisation_id,p_user_id\)<>'verified'/);
  assert.match(sessionMigration, /token_hash=extensions\.digest/);
  assert.match(sessionMigration, /if r\.status='redeemed' then return .*'already_used',true/s);
  assert.match(sessionMigration, /This session request has expired/);
  assert.match(sessionMigration, /p_bed_type<>r\.bed_type or p_duration_minutes<>r\.duration_minutes/);
});

test("Club navigation exposes staff operations and gates management reporting", async () => {
  const [shell, layout, management, page] = await Promise.all([
    readFile(shellPath, "utf8"), readFile(layoutPath, "utf8"), readFile(managementPath, "utf8"), readFile(pagePath, "utf8"),
  ]);
  assert.match(shell, /access\.glowZone \? \[\{ label: "Glow Zone", href: `\/club\/sunbeds/);
  assert.match(shell, /mobileNavigation = \[/);
  assert.doesNotMatch(shell.slice(shell.indexOf("const mobileNavigation"), shell.indexOf("const isGroupOpen")), /Glow Zone/);
  assert.match(layout, /context\.navigation\.services&&carlton/);
  assert.match(layout, /club_location_authorized/);
  assert.match(layout, /access\.data===true/);
  assert.match(shell, /access\.services && access\.management \? \[\{ label: "Glow Zone management"/);
  assert.match(management, /context\.navigation\.services && context\.navigation\.management && !glowAccess\.error && glowAccess\.data === true/);
  assert.match(management, /club_location_authorized/);
  assert.doesNotMatch(shell, /Glow Zone management[^\n]*access\.finance/);
  assert.match(page, /params\?\.view==="management"&&canViewFinance/);
  assert.match(page, /club_location_authorized/);
});

test("cash minute sales use existing authorized catalogue RPC; direct balance spending is absent", async () => {
  const [actions, ui] = await Promise.all([readFile(actionsPath, "utf8"), readFile(operationUiPath, "utf8")]);
  assert.match(actions, /club_glow_complete_sale/);
  assert.match(actions, /payments\.record_cash/);
  assert.match(actions, /club_location_authorized/);
  assert.match(ui, /customer\.isActiveMember \? "member-30" : "standard-30"/);
  assert.match(ui, /crypto\.randomUUID\(\)/);
  assert.doesNotMatch(ui, /recordSunbedUseAction|club_glow_spend/);
});

test("finance labels Glow Zone as an included Products & Services breakdown", async () => {
  const page = await readFile(financePagePath, "utf8");
  assert.match(page, /club_glow_sales/);
  assert.match(page, /\.eq\("status", "completed"\)/);
  assert.match(page, /Glow Zone minute sales · Products &amp; Services/);
  assert.match(page, /summary\.netMinor \+ \(glowSalesUnavailable \? 0 : glowSalesMinor\)/);
});
