import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { searchStaffMemberRecords } from "../lib/club-member-search";

test("Club shop keeps payment paths behind repository actions", () => {
  const actions = readFileSync(new URL("../app/club/shop/actions.ts", import.meta.url), "utf8");
  const component = readFileSync(new URL("../components/club-shop.tsx", import.meta.url), "utf8");
  assert.match(actions, /createCommerceOrder/); assert.match(actions, /spendBalance/); assert.match(actions, /declareCash/); assert.match(actions, /recordCashPayment/); assert.match(actions, /reconcileCash/);
  assert.doesNotMatch(component, /from\(["']club_/); assert.match(component, /Awaiting cash verification/); assert.match(component, /External payment not connected/);
});

test("Club shop presents factual order states without fake provider success", () => {
  const component = readFileSync(new URL("../components/club-shop.tsx", import.meta.url), "utf8");
  for (const state of ["pending_payment", "awaiting_cash_verification", "cash_disputed", "paid", "fulfilled", "cancelled", "refunded"]) assert.match(component, new RegExp(state));
  assert.match(component, /Gym Balance/); assert.match(component, /Cash box/);
});

test("shop actions require explicit organisation context and discrepancy details", () => {
  const actions = readFileSync(new URL("../app/club/shop/actions.ts", import.meta.url), "utf8");
  const checkout = readFileSync(new URL("../components/club-staff-checkout.tsx", import.meta.url), "utf8");
  assert.match(actions, /input\.organisationId/); assert.match(actions, /context\(input\.organisationId\)/); assert.match(actions, /Number\.isInteger\(input\.quantity\)/);
  assert.match(actions, /discrepancyMinor/); assert.match(checkout, /customerId/); assert.match(checkout, /Walk-in/); assert.match(checkout, /organisationId/);
  assert.match(actions, /payments\.record_cash/); assert.match(actions, /cash\.reconcile/); assert.match(actions, /payment\.cash_recorded/);
});

test("member cash declarations defer stock effects until staff confirmation", () => {
  const migration = readFileSync(new URL("../supabase/migrations/2026-09-21-club-cash-settlement-safety.sql", import.meta.url), "utf8");
  const declaration = migration.slice(0, migration.indexOf("create or replace function public.club_reconcile_cash_declaration"));
  const reconcile = migration.slice(migration.indexOf("create or replace function public.club_reconcile_cash_declaration"));
  assert.doesNotMatch(declaration, /club_stock_movements/);
  assert.match(declaration, /awaiting_cash_verification/);
  assert.match(reconcile, /p_status='confirmed'/);
  assert.match(reconcile, /cash-confirmed:/);
  assert.match(reconcile, /p_status='rejected'|cash_disputed/);
});

test("staff Sell keeps a two-area till with exact barcode and basket paths", () => {
  const checkout = readFileSync(new URL("../components/club-staff-checkout.tsx", import.meta.url), "utf8");
  const tabs = readFileSync(new URL("../components/club-shop-tabs.tsx", import.meta.url), "utf8");
  assert.match(checkout, /Scan barcode/);
  assert.match(checkout, /normalizeBarcode/);
  assert.match(checkout, /checkout-products/);
  assert.match(checkout, /checkout-basket/);
  assert.match(checkout, /staffCashSaleAction/);
  assert.match(checkout, /staffBalanceSaleAction/);
  assert.doesNotMatch(tabs, />Cash<\/a>/);
});

test("staff POS customer lookup is server-backed and catalogue stays dense", () => {
  const checkout = readFileSync(new URL("../components/club-staff-checkout.tsx", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../app/club/shop/actions.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(checkout, /searchStaffCustomersAction/);
  assert.match(checkout, /Member search is unavailable/);
  assert.match(checkout, /No members match that search/);
  assert.match(checkout, /customer\.id/);
  assert.match(actions, /listCustomers\(value\.organisation\.id\)/);
  assert.match(actions, /listMemberSummaries\(value\.organisation\.id\)/);
  assert.match(actions, /searchStaffMemberRecords/);
  assert.match(actions, /members\.view/);
  assert.match(css, /\.checkout-finding\{display:grid;grid-template-columns:minmax\(0,2fr\)/);
  assert.match(css, /\.staff-checkout \.checkout-products\{grid-template-columns:repeat\(auto-fill/);
  assert.match(checkout, /aria-label="Search member"/);
});

test("staff member search wiring includes unlinked canonical members and isolates organisations", () => {
  const customers = [{ id: "customer-a", organisationId: "org-a", displayName: "Other label", userId: "user-a", status: "member", createdAt: "", updatedAt: "" }] as const;
  const members = [{ id: "member-a", organisationId: "org-a", userId: "user-a", role: "member", active: true, displayName: "Peter Gray", email: "peter@example.test", accessState: "active" }, { id: "member-b", organisationId: "org-b", userId: "user-b", role: "member", active: true, displayName: "Peter Other", accessState: "active" }] as const;
  const results = searchStaffMemberRecords("org-a", "  pet ", [...customers], [...members]);
  assert.deepEqual(results.map(result => result.id), ["customer-a"]);
  assert.equal(results[0]?.displayName, "Peter Gray");
  const unlinked = searchStaffMemberRecords("org-a", "jane", [], [{ ...members[0], id: "member-jane", displayName: "Jane Smith", userId: "user-jane" }]);
  assert.equal(unlinked[0]?.id, "member-jane");
});

test("staff checkout presents a real physical location context", () => {
  const checkout = readFileSync(new URL("../components/club-staff-checkout.tsx", import.meta.url), "utf8");
  const shell = readFileSync(new URL("../components/club-shell.module.css", import.meta.url), "utf8");
  assert.match(checkout, /checkout-location-status/);
  assert.match(checkout, /Establish a physical venue in Club navigation/);
  assert.match(shell, /\.links\{overflow:visible\}/);
});

test("POS and family picker use exact product media without inventing imagery", () => {
  const checkout = readFileSync(new URL("../components/club-staff-checkout.tsx", import.meta.url), "utf8");
  const picker = readFileSync(new URL("../components/club-member-shop.tsx", import.meta.url), "utf8");
  const media = readFileSync(new URL("../components/club-product-media.tsx", import.meta.url), "utf8");
  assert.match(media, /product\?\.media\?\.url/);
  assert.match(checkout, /ClubProductMedia product=\{product\}/);
  assert.match(checkout, /checkout-scan-confirmation/);
  assert.match(checkout, /Added to basket/);
  assert.match(checkout, /normalizeBarcode\(item\.barcode/);
  assert.match(picker, /sharedProductImage\(card\.variants\)/);
  assert.doesNotMatch(checkout, /Creatine Gummies/);
  const shop = readFileSync(new URL("../components/club-shop.tsx", import.meta.url), "utf8");
  assert.match(shop, /scannedProduct \? <div className="checkout-scan-confirmation"/);
  assert.match(shop, /setScannedProduct\(matches\[0\]\)/);
});

test("staff POS keeps an immutable receipt while resetting the next sale", () => {
  const checkout = readFileSync(new URL("../components/club-staff-checkout.tsx", import.meta.url), "utf8");
  assert.match(checkout, /CompletedSaleSummary/);
  assert.match(checkout, /setCompletedSale\(\{ totalMinor: total, payment, customerName: selectedMember\?\.displayName/);
  assert.match(checkout, /completedSale\.totalMinor/);
  assert.match(checkout, /completedSale\.customerName/);
  assert.match(checkout, /completedSale\.locationName/);
  assert.match(checkout, /setCompletedSale\(undefined\)/);
  assert.match(checkout, /completedSale\.payment === \"balance\"/);
});

test("staff POS keeps member identity separate from commerce customer identity", () => {
  const checkout = readFileSync(new URL("../components/club-staff-checkout.tsx", import.meta.url), "utf8");
  assert.match(checkout, /selectedMember/);
  assert.match(checkout, /setCustomerId\(customer\.linkedCustomerId \?\? ""\)/);
  assert.match(checkout, /ensureStaffMemberCustomerAction/);
  assert.match(checkout, /customerName: selectedMember\?\.displayName/);
  assert.doesNotMatch(checkout, /Payment method<select/);
  assert.match(checkout, /Madhouse Balance/);
  const actions = readFileSync(new URL("../app/club/shop/actions.ts", import.meta.url), "utf8");
  assert.match(actions, /authoritative directory source/);
  assert.match(actions, /listMemberSummaries\(value\.organisation\.id\)/);
  assert.match(actions, /customers = \[\]/);
});

test("staff checkout transparently ensures a member commerce identity", () => {
  const actions = readFileSync(new URL("../app/club/shop/actions.ts", import.meta.url), "utf8");
  const checkout = readFileSync(new URL("../components/club-staff-checkout.tsx", import.meta.url), "utf8");
  assert.match(actions, /ensureStaffMemberCustomerAction/);
  assert.match(actions, /createCustomer\(\{ organisationId: value\.organisation\.id, userId: member\.userId/);
  assert.match(actions, /find\(item => item\.userId === member\.userId\)/);
  assert.match(checkout, /ensureStaffMemberCustomerAction\(\{ organisationId, memberId: member\.id \}\)/);
  assert.doesNotMatch(checkout, /Account link required/);
  assert.match(actions, /staffSpendBalance/);
  assert.match(actions, /payments\.record_cash/);
});

test("staff checkout follows the canonical venue when Club navigation changes", () => {
  const checkout = readFileSync(new URL("../components/club-staff-checkout.tsx", import.meta.url), "utf8");
  assert.match(checkout, /currentLocationId, locations/);
  assert.match(checkout, /setLocationId\(resolved\)/);
  assert.match(checkout, /locationId, customerId/);
});

test("staff POS resolves only an authorised physical location", () => {
  const checkout = readFileSync(new URL("../components/club-staff-checkout.tsx", import.meta.url), "utf8");
  assert.match(checkout, /resolveStaffSaleLocationId/);
  assert.match(checkout, /physical\.length === 1 \? physical\[0\]\.id : ""/);
  assert.match(checkout, /\["total", "all", "all-sites"\]/);
});

test("membership cash keeps obligation and declaration settlement distinct", () => {
  const migration = readFileSync(new URL("../supabase/migrations/2026-10-05-club-membership-cash-settlement.sql", import.meta.url), "utf8");
  assert.match(migration, /club_membership_billing_obligations/);
  assert.match(migration, /payment_method_family='cash'/);
  assert.match(migration, /club_record_membership_cash_payment/);
  assert.match(migration, /club_declare_membership_cash_drop/);
  assert.match(migration, /member_drop_box/);
  assert.match(migration, /cash-declaration:/);
  assert.match(migration, /state not in \('paid','recovered','cancelled','waived'\)/);
  assert.match(migration, /club_location_authorized/);
  assert.doesNotMatch(migration.slice(migration.indexOf("club_declare_membership_cash_drop")), /update public\.club_membership_billing_obligations set state='paid'/);
});
