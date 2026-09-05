import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { discountAmount, reminderAllowed, reminderKey, shelfCheckEligible, stockRemovalEffect } from "../lib/club-shelf-operations";

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
  const first = new Date("2026-09-10T12:00:00Z");
  assert.equal(reminderAllowed(first, new Date("2026-09-10T13:00:00Z")), false);
  assert.equal(reminderAllowed(first, new Date("2026-09-11T12:00:00Z")), true);
  assert.equal(discountAmount("comp", 1250, 1, 1), 1250);
  assert.throws(() => discountAmount("percentage", 1250));
  assert.throws(() => discountAmount("fixed", 1250));
  assert.deepEqual(stockRemovalEffect(2, "staff_consumption"), { quantityDelta: -2, reason: "staff_consumption" });
  assert.match(sql, /club_notification_events/);
  assert.match(sql, /club_collection_reminder_events/);
  assert.match(sql, /created_at>=now\(\)-interval '24 hours'/);
  assert.match(sql, /already_recorded/);
  assert.match(sql, /unique\(organisation_id,idempotency_key\)/);
  assert.match(sql, /stock_removal:/);
  assert.match(sql, /commerce\.pricing_manage/);
  assert.match(sql, /discount_minor/);
  assert.match(sql, /discount exceeds order value/i);
  assert.match(sql, /when p_kind='fixed' then p_value_minor else o\.subtotal_minor/);
  assert.match(sql, /Invalid percentage discount/);
  assert.match(sql, /Invalid fixed discount/);
  assert.match(sql, /cost_unit_minor,actor_user_id/);
  assert.match(sql, /commerce\.stock_remove/);
  assert.match(sql, /v_order\.status='pending_payment' and v_order\.total_minor=0/);
  assert.match(sql, /perform public\.club_finalize_paid_order\(o\.id,auth\.uid\(\)\)/);
  assert.match(sql, /revoke all on function public\.club_finalize_paid_order\(uuid,uuid\) from public,anon,authenticated/);
});

test("customer allocations remain separate from free stock and require shelf confirmation", () => {
  assert.match(sql, /collection_code/);
  assert.match(sql, /shelf_confirmed_at/);
  assert.match(sql, /Customer allocation is not ready for shelf placement/);
  assert.match(sql, /quantity_allocated<d\.quantity_required/);
  assert.match(sql, /supplier\.receive/);
});
