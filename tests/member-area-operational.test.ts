import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { memberMembershipStateLabel, memberOrderStateLabel } from "../lib/club-operational";

test("member purchase states use clear fulfilment wording", () => {
  assert.equal(memberOrderStateLabel("awaiting_delivery"), "Awaiting supplier");
  assert.equal(memberOrderStateLabel("ready_for_collection"), "Ready for collection");
  assert.equal(memberOrderStateLabel("collected"), "Collected");
  assert.equal(memberOrderStateLabel("partially_refunded"), "In progress");
  assert.equal(memberOrderStateLabel("refunded"), "Refunded");
});

test("member membership states are rendered with safe labels", () => {
  assert.equal(memberMembershipStateLabel("paused"), "Paused");
  assert.equal(memberMembershipStateLabel("expired"), "Expired");
  assert.equal(memberMembershipStateLabel("unknown_internal_state"), "Status unavailable");
});

test("Member order history uses member-safe supplier status and refund reads", () => {
  const page = readFileSync("app/member-hub/orders/page.tsx", "utf8");
  const migration = readFileSync("supabase/migrations/2026-12-14-member-purchase-history.sql", "utf8");
  assert.match(page, /club_list_member_supplier_fulfilment/);
  assert.match(page, /club_list_my_service_credit_balances/);
  assert.ok(page.includes('String(item.credit_key)!=="sunbed_minutes"'));
  assert.match(page, /club_list_my_order_refunds/);
  assert.match(page, /Refund details are temporarily unavailable/);
  assert.match(migration, /o\.user_id=auth\.uid\(\)/);
  assert.match(migration, /c\.user_id=auth\.uid\(\)/);
  assert.doesNotMatch(migration.split("-- The staff-facing")[0], /external_reference|created_by|'reason'/);
  assert.match(migration, /club_get_my_access_eligibility/);
  assert.match(migration, /c\.organisation_id=p_organisation_id and c\.user_id=auth\.uid\(\)/);
  assert.match(migration, /l\.access_mode='DOOR_CONTROLLED'/);
  assert.match(migration, /club_list_my_service_credit_balances/);
  assert.match(migration, /l\.expires_at is null or l\.expires_at>now\(\)/);
  assert.match(migration, /revoke all on function public\.club_list_my_order_refunds\(uuid,uuid\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.club_list_my_order_refunds\(uuid,uuid\) to authenticated/);
  assert.match(migration, /revoke all on function public\.club_list_my_service_credit_balances\(uuid\) from public,anon,authenticated/);
  assert.match(migration, /revoke all on function public\.club_get_my_access_eligibility\(uuid\) from public,anon,authenticated/);
  assert.doesNotMatch(migration, /p_user_id|p_customer_id/);
  assert.equal((migration.match(/set search_path=pg_catalog,public/g) ?? []).length, 3);
});

test("GLOW member page never falls back to an unexpired-agnostic credit sum", () => {
  const page = readFileSync("app/member-hub/glow-zone/page.tsx", "utf8");
  assert.match(page, /Only unexpired minutes are shown as available/);
  assert.match(page, /Balance temporarily unavailable/);
  assert.doesNotMatch(page, /profile\.serviceCredits/);
});

test("Member Hub shows membership dates, shared holder indicator and Balance activity", () => {
  const hub = readFileSync("components/member-hub.tsx", "utf8");
  assert.match(hub, /membership\.startsAt/);
  assert.match(hub, /membership\.endsAt/);
  assert.match(hub, /Shared family membership/);
  assert.match(hub, /balanceHistory/);
  assert.match(hub, /memberAccessReason/);
});
