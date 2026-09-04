import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
