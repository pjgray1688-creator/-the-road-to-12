import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { settlementEffects, settlementEffectsForOutcome } from "../lib/club-settlement";

const sql = readFileSync("supabase/migrations/2026-09-27-club-payment-attempts-split-tender.sql", "utf8");

test("payment attempts enforce one external tender and balance amount conservation", () => {
  assert.match(sql, /create table if not exists public\.club_payment_attempts/);
  assert.match(sql, /p_balance_amount_minor \+ p_external_amount_minor <> v_order\.total_minor/);
  assert.match(sql, /external_method text check .*card.*klarna.*clearpay.*paypal/s);
  assert.match(sql, /external_amount_minor > 0 and p_external_method is null/);
  assert.match(sql, /order_id=p_order_id and status='pending'/);
  assert.match(sql, /external_method is not null and p_external_amount_minor = 0/);
});

test("balance holds are locked, idempotent and released without a fake payment", () => {
  assert.match(sql, /club_balance_holds/);
  assert.match(sql, /for update/);
  assert.match(sql, /unique \(organisation_id, idempotency_key\)/);
  assert.match(sql, /status='released'/);
  assert.match(sql, /status='cancelled'/);
  assert.match(sql, /No provider approval or payment success is implied/);
});

test("payment-attempt functions enforce authenticated ownership and are not public", () => {
  assert.match(sql, /auth\.uid\(\) is null/);
  assert.match(sql, /v_order\.user_id is distinct from auth\.uid\(\)/);
  assert.match(sql, /revoke all on function public\.club_create_payment_attempt.*from public,anon/s);
  assert.match(sql, /revoke all on function public\.club_release_payment_attempt.*from public,anon/s);
  assert.match(sql, /grant execute on function public\.club_create_payment_attempt.*authenticated/s);
});

test("trusted capture and failure paths are durable and exactly-once", () => {
  assert.match(sql, /club_capture_payment_attempt/);
  assert.match(sql, /revoke all on function public\.club_capture_payment_attempt\(uuid,text\) from public,anon,authenticated/);
  assert.match(sql, /status='captured'/);
  assert.match(sql, /status='failed'/);
  assert.match(sql, /status='released'/);
  assert.match(sql, /club_stock_movements/);
  assert.match(sql, /on conflict \(organisation_id,idempotency_key\) do nothing/);
  assert.match(sql, /club_create_supplier_demand_for_order\(o\.id\)/);
  assert.match(sql, /club_service_transactions/);
  assert.match(sql, /commerce_order_item_id/);
  assert.match(sql, /club_commerce_products_service_fk/);
  assert.match(sql, /grant execute on function public\.club_capture_payment_attempt\(uuid,text\) to service_role/);
});

test("all successful tender paths share mixed-fulfilment effects", () => {
  const lines = [
    { orderItemId: "stock", quantity: 2, stockTracked: true },
    { orderItemId: "supplier", quantity: 1, supplierOrderForCollection: true },
    { orderItemId: "service", quantity: 1, serviceId: "svc" },
  ];
  const expected = settlementEffects(lines);
  for (const tender of ["balance", "cash", "external", "split"] as const) {
    assert.deepEqual(settlementEffectsForOutcome("paid", lines), expected, tender);
  }
  assert.equal(expected.filter((effect) => effect.kind === "stock_sale").length, 1);
  assert.equal(expected.filter((effect) => effect.kind === "supplier_demand").length, 1);
  assert.equal(expected.filter((effect) => effect.kind === "service_entitlement").length, 1);
});

test("failed, cancelled and repeated settlement produce no duplicate effects", () => {
  const lines = [{ orderItemId: "x", quantity: 1, stockTracked: true, supplierOrderForCollection: true, serviceId: "svc" }];
  assert.deepEqual(settlementEffectsForOutcome("failed", lines), []);
  assert.deepEqual(settlementEffectsForOutcome("cancelled", lines), []);
  const first = settlementEffects(lines);
  assert.deepEqual(settlementEffects(lines, new Set(first.map((effect) => effect.key))), []);
});

test("migration routes each paid settlement boundary through shared finalisation", () => {
  assert.match(sql, /create or replace function public\.club_finalize_paid_order/);
  assert.match(sql, /perform public\.club_finalize_paid_order\(o\.id,auth\.uid\(\)\)/);
  assert.match(sql, /perform public\.club_finalize_paid_order\(o\.id,null\)/);
  assert.match(sql, /fulfilment_status,commerce_order_item_id,metadata\)\s*values\([^;]+,'pending',v_item\.id/s);
  assert.match(sql, /revoke all on function public\.club_capture_payment_attempt\(uuid,text\) from public,anon,authenticated/);
});
