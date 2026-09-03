import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Club shop keeps payment paths behind repository actions", () => {
  const actions = readFileSync(new URL("../app/club/shop/actions.ts", import.meta.url), "utf8");
  const component = readFileSync(new URL("../components/club-shop.tsx", import.meta.url), "utf8");
  assert.match(actions, /createCommerceOrder/); assert.match(actions, /spendBalance/); assert.match(actions, /declareCash/); assert.match(actions, /recordCashPayment/); assert.match(actions, /reconcileCash/);
  assert.doesNotMatch(component, /from\(["']club_/); assert.match(component, /Awaiting cash verification/); assert.match(component, /Card \/ online payment coming shortly/);
});

test("Club shop presents factual order states without fake provider success", () => {
  const component = readFileSync(new URL("../components/club-shop.tsx", import.meta.url), "utf8");
  for (const state of ["pending_payment", "awaiting_cash_verification", "cash_disputed", "paid", "fulfilled", "cancelled", "refunded"]) assert.match(component, new RegExp(state));
  assert.match(component, /Madhouse Balance/); assert.match(component, /Cash box/);
});
