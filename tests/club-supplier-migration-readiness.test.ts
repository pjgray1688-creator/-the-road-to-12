import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const supplier = readFileSync(new URL("../supabase/migrations/2026-09-22-club-supplier-commerce.sql", import.meta.url), "utf8");
const capabilities = readFileSync(new URL("../supabase/migrations/2026-09-23-club-supplier-capabilities.sql", import.meta.url), "utf8");

const occurrences = (source: string, pattern: RegExp) => source.match(pattern)?.length ?? 0;

test("supplier migration contains one final definition per trusted function", () => {
  for (const name of ["club_create_supplier_order_batch", "club_allocate_supplier_units", "club_list_supplier_demand", "club_list_member_supplier_fulfilment"]) {
    assert.equal(occurrences(supplier, new RegExp(`create or replace function public\\.${name}\\(`, "g")), 1, name);
  }
  assert.doesNotMatch(supplier, /count\(\*\)\s*\+\s*1/);
  assert.equal(occurrences(supplier, /create table if not exists public\.club_supplier_order_batches/g), 1);
  assert.equal(occurrences(supplier, /create table if not exists public\.club_supplier_order_batch_lines/g), 1);
  assert.doesNotMatch(supplier, /Replace the batching body|Correct demand accounting|Include supplier_id/);
});

test("supplier migration keeps security, idempotency and stock invariants", () => {
  assert.match(supplier, /revoke all on function public\.club_create_supplier_demand_for_order\(uuid\) from public,anon,authenticated/);
  assert.match(supplier, /unique \(organisation_id, reference\)/);
  assert.match(supplier, /unique\(organisation_id,idempotency_key\)/);
  assert.match(supplier, /on conflict \(order_item_id\) do nothing/);
  assert.match(supplier, /commerce\.collections_manage/);
  assert.match(supplier, /supplier\.receive/);
  assert.match(supplier, /'queued'/);
  assert.doesNotMatch(supplier, /insert into public\.club_stock_movements/);
});

test("capability migration extends canonical presets without dropping existing rules", () => {
  for (const cap of ["supplier.catalogue_manage", "supplier.orders_manage", "supplier.receive", "commerce.pricing_manage", "commerce.collections_manage"]) assert.match(capabilities, new RegExp(cap.replace(".", "\\.")));
  for (const existing of ["staff.permissions_manage", "cash.reconcile", "inventory.adjust", "memberships.assign"]) assert.match(capabilities, new RegExp(existing.replace(".", "\\.")));
  assert.match(capabilities, /decision='deny'.*then false/s);
  assert.match(capabilities, /decision='allow'.*then true/s);
  assert.match(capabilities, /role='gym_staff'.*supplier\.receive.*commerce\.collections_manage/s);
  assert.match(capabilities, /or \(m\.role='trainer' and p_capability='members\.view'\)/);
});

test("migration order is explicit and dependencies precede supplier functions", () => {
  assert.ok(supplier.indexOf("create table if not exists public.club_supplier_demand") < supplier.indexOf("create or replace function public.club_create_supplier_demand_for_order"));
  assert.ok(supplier.indexOf("create table if not exists public.club_supplier_order_counters") < supplier.indexOf("create or replace function public.club_create_supplier_order_batch"));
  assert.ok(capabilities.includes("alter table public.club_staff_permission_overrides"));
});
