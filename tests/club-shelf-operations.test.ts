import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reminderKey, shelfCheckEligible, stockRemovalEffect } from "../lib/club-shelf-operations";

const sql = readFileSync("supabase/migrations/2026-09-29-club-shelf-removals-discounts.sql", "utf8");
const now = new Date("2026-09-10T12:00:00Z");

test("shelf ageing prompts a physical check but never infers pickup", () => {
  assert.equal(shelfCheckEligible({ status: "ready_for_collection", locationId: "r", readyAt: new Date("2026-09-07T12:00:00Z") }, now), true);
  assert.equal(shelfCheckEligible({ status: "ready_for_collection", locationId: "r", readyAt: new Date("2026-09-08T12:00:00Z") }, now), false);
  assert.equal(shelfCheckEligible({ status: "collected", locationId: "r", readyAt: new Date("2026-09-01T12:00:00Z") }, now), false);
  assert.match(sql, /ready_at<=now\(\)-interval '3 days'/);
  assert.match(sql, /physical_check/);
  assert.doesNotMatch(sql, /set status='collected'.*shelf/i);
});

test("reminders and removals are auditable and idempotent", () => {
  assert.equal(reminderKey("order"), reminderKey("order"));
  assert.deepEqual(stockRemovalEffect(2, "staff_consumption"), { quantityDelta: -2, reason: "staff_consumption" });
  assert.match(sql, /club_notification_events/);
  assert.match(sql, /club_collection_reminder_once_uq/);
  assert.match(sql, /unique\(organisation_id,idempotency_key\)/);
  assert.match(sql, /stock_removal:/);
  assert.match(sql, /commerce\.pricing_manage/);
  assert.match(sql, /discount_minor/);
  assert.match(sql, /discount exceeds order value/i);
});

test("customer allocations remain separate from free stock and require shelf confirmation", () => {
  assert.match(sql, /collection_code/);
  assert.match(sql, /shelf_confirmed_at/);
  assert.match(sql, /Customer allocation is not ready for shelf placement/);
  assert.match(sql, /quantity_allocated<d\.quantity_required/);
  assert.match(sql, /supplier\.receive/);
});
