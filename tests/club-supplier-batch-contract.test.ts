import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../supabase/migrations/2026-09-22-club-supplier-commerce.sql", import.meta.url), "utf8");
test("supplier batch contract is durable, scoped and idempotent", () => { for (const term of ["create table if not exists public.club_supplier_order_batches", "unique(batch_id,supplier_product_id)", "on conflict (order_item_id) do nothing", "supplier.orders_manage", "club_mark_supplier_ordered"]) assert.ok(sql.includes(term), `missing ${term}`); });
test("internal demand helper is not granted to authenticated clients", () => { assert.ok(sql.includes("revoke all on function public.club_create_supplier_demand_for_order(uuid) from public,anon,authenticated")); });
