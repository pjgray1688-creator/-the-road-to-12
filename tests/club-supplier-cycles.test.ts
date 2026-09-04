import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { replenishmentQuantity, supplierCycleFor } from "@/lib/club-supplier-cycles";

test("replenishment accounts for inbound stock", () => { assert.equal(replenishmentQuantity(3, 5, 10, 0), 7); assert.equal(replenishmentQuantity(3, 5, 10, 3), 0); assert.equal(replenishmentQuantity(6, 5, 10, 0), 0); });
test("incomplete supplier schedule is truthful", () => { assert.match(supplierCycleFor(new Date(), { timezone: "Europe/London" }).message, /timing confirmed after order/); });

test("supplier cycles respect the supplier timezone and cutoff", () => {
  const schedule = { timezone: "Europe/London", cutoffWeekday: 1, cutoffLocalTime: "23:59", orderWeekday: 2, deliveryStartWeekday: 3 };
  const before = supplierCycleFor(new Date("2026-09-07T22:00:00.000Z"), schedule);
  const after = supplierCycleFor(new Date("2026-09-08T00:10:00.000Z"), schedule);
  assert.equal(before.key, "Europe/London:2026-09-08");
  assert.equal(after.key, "Europe/London:2026-09-15");
  assert.match(before.message, /Order by Monday 23:59 · expected Wednesday collection/);
});

test("delivery windows and disabled ordering stay truthful", () => {
  const schedule = { timezone: "Europe/London", cutoffWeekday: 1, cutoffLocalTime: "23:59", orderWeekday: 2, deliveryStartWeekday: 3, deliveryEndWeekday: 4 };
  assert.match(supplierCycleFor(new Date("2026-09-07T20:00:00.000Z"), schedule).message, /Wednesday–Thursday collection/);
  assert.match(supplierCycleFor(new Date(), { ...schedule, orderingActive: false }).message, /timing confirmed after order/);
});

test("supplier-cycle migration contains durable cycle and provenance boundaries", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/2026-09-26-club-supplier-cycles.sql"), "utf8");
  assert.match(sql, /create table if not exists public\.club_supplier_order_cycles/);
  assert.match(sql, /create table if not exists public\.club_supplier_replenishment_requirements/);
  assert.match(sql, /club_prepare_supplier_cycle/);
  assert.match(sql, /member_quantity/);
  assert.match(sql, /replenishment_quantity/);
  assert.match(sql, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'supplier\.orders_manage'\)/);
});
