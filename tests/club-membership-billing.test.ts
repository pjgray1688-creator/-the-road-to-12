import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateBillingState, lifecycleNotificationKey } from "../lib/club-billing-policy";

const sql = readFileSync("supabase/migrations/2026-09-28-club-membership-billing-dunning.sql", "utf8");

test("billing policy keeps grace active and suspends only at configured threshold", () => {
  const due = new Date("2026-01-01T00:00:00Z");
  assert.equal(evaluateBillingState("upcoming", due, new Date("2026-01-03T00:00:00Z"), { suspendAfterDays: 7, accessSuspensionEnabled: true }), "grace");
  assert.equal(evaluateBillingState("grace", due, new Date("2026-01-08T00:00:00Z"), { suspendAfterDays: 7, accessSuspensionEnabled: true }), "overdue");
  assert.equal(evaluateBillingState("grace", due, new Date("2026-01-08T00:00:00Z"), { suspendAfterDays: 7, accessSuspensionEnabled: false }), "grace");
});

test("billing lifecycle effects are idempotent and provider-neutral", () => {
  assert.equal(lifecycleNotificationKey("obligation", "grace_reminder"), lifecycleNotificationKey("obligation", "grace_reminder"));
  assert.match(sql, /unique \(organisation_id, provider_event_key\)/);
  assert.match(sql, /unique \(obligation_id\)/);
  assert.match(sql, /state in \('upcoming','due','payment_pending','paid','failed','grace','retry_scheduled','recovered','overdue','waived','cancelled'\)/);
  assert.match(sql, /grant execute on function public\.club_ingest_membership_payment_event[^;]+to service_role/s);
  assert.match(sql, /auth\.uid\(\)=p_user_id/);
  assert.match(sql, /state='grace'/);
  assert.match(sql, /access_suspension_enabled/);
  assert.match(sql, /late_fee_enabled/);
  assert.match(sql, /default 'unavailable'/);
  assert.match(sql, /club_check_member_location_access/);
  assert.match(sql, /reason','payment_overdue'/);
  assert.match(sql, /payments\.take/);
});

test("membership billing supports provider-managed and R12-requested retries without claiming execution", () => {
  assert.match(sql, /strategy text not null check \(strategy in \('provider_managed','r12_requested'\)\)/);
  assert.match(sql, /result is null or result in \('pending','succeeded','failed','unavailable','cancelled'\)/);
  assert.match(sql, /provider credentials|historical payments are fabricated/i);
});
