import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/2026-09-22-club-supplier-commerce.sql", "utf8");
const actions = readFileSync("app/club/shop/supplier-orders/actions.ts", "utf8");

test("collection workflow has capability-separated trusted boundaries", () => {
  assert.match(actions, /authorised\(org,"supplier\.receive"\)/g);
  assert.match(migration, /club_list_ready_collections/);
  assert.match(migration, /club_confirm_collection/);
  assert.match(migration, /club_capability_allowed\(p_organisation_id,v_user,'commerce\.collections_manage'\)/);
  assert.match(migration, /collected_by uuid references auth\.users/);
});

test("collection transition is safe and does not touch inventory", () => {
  const fn = migration.slice(migration.lastIndexOf("create or replace function public.club_confirm_collection"));
  assert.match(fn, /status='collected'/);
  assert.match(fn, /collected_at=coalesce\(collected_at/);
  assert.match(fn, /collected_by=coalesce\(collected_by/);
  assert.doesNotMatch(fn, /inventory|stock_movements|stock_balances/);
  assert.match(migration, /order_ready_for_collection/);
});

test("member fulfilment read is identity scoped", () => {
  const start = migration.lastIndexOf("create or replace function public.club_list_member_supplier_fulfilment");
  const fn = migration.slice(start);
  assert.match(fn, /d\.user_id=p_user_id/);
  assert.match(fn, /auth\.uid\(\)=p_user_id/);
  assert.match(fn, /'awaiting_delivery'/);
  assert.match(fn, /'ready_for_collection'/);
  assert.match(fn, /'collected'/);
});
