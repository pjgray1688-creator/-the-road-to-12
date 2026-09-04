import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  assert.match(actions, /discrepancyMinor/); assert.match(checkout, /customerId/); assert.match(checkout, /Walk-in sale/); assert.match(checkout, /organisationId/);
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
