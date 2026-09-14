import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("stock reservations use transactional advisory locking and active balances", () => {
  const sql = readFileSync(new URL("../supabase/migrations/2026-09-14-club-stock-reservations.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.club_stock_reservations/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /status='active'/);
  assert.match(sql, /v_available:=v_on_hand-v_reserved\+v_existing/);
  assert.match(sql, /club_stock_reservation_order_status/);
  assert.match(sql, /club_stock_reservation_sale/);
});

test("member checkout requests a reservation before payment", () => {
  const source = readFileSync(new URL("../app/club/shop/actions.ts", import.meta.url), "utf8");
  assert.match(source, /club_reserve_order_stock/);
  assert.match(source, /reservationError/);
});

test("stock balance repository subtracts active reservations", () => {
  const source = readFileSync(new URL("../lib/supabase-club-repository.ts", import.meta.url), "utf8");
  assert.match(source, /club_stock_reservations/);
  assert.match(source, /status.*active/);
});
