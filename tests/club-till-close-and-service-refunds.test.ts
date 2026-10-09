import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { serviceRefundAllowance, serviceUnitsForRefund } from "../lib/service-refund";
import { calculateTillVarianceMinor } from "../lib/club-till";

const sql = readFileSync("supabase/migrations/2026-12-10-club-till-close-and-service-refunds.sql", "utf8");
const page = readFileSync("app/club/shop/page.tsx", "utf8");
const actions = readFileSync("app/club/shop/actions.ts", "utf8");
const component = readFileSync("components/club-till-close.tsx", "utf8");
const refundView = readFileSync("components/club-recent-sales.tsx", "utf8");

test("till expected cash includes cash sales and declarations, and deducts cash refunds", () => {
  const calculator = sql.slice(sql.indexOf("create or replace function public.club_calculate_till_expected_cash"), sql.indexOf("create or replace function public.club_preview_till_close"));
  assert.match(calculator, /p\.method='cash'/);
  assert.match(calculator, /p\.status in \('paid','partially_refunded','refunded'\)/);
  assert.match(calculator, /select -r\.amount_minor::bigint/);
  assert.match(calculator, /d\.status='confirmed'/);
  assert.match(calculator, /d\.purpose in \('membership','balance_top_up','other'\)/);
  assert.match(calculator, /at time zone 'Europe\/London'/);
  assert.doesNotMatch(calculator, /p_client_expected|p_expected_cash/);
});

test("till close is capability- and location-gated, immutable and unique per operational period", () => {
  assert.match(sql, /unique \(organisation_id, location_id, business_date, register_name\)/);
  assert.match(sql, /variance_minor integer generated always as \(counted_cash_minor - expected_cash_minor\) stored/);
  assert.match(sql, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'cash\.reconcile'\)/);
  assert.match(sql, /club_location_authorized\(p_organisation_id,p_location_id\)/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /cash\.till_closed/);
  assert.match(sql, /club_payments_closed_till_guard/);
  assert.match(sql, /club_refunds_closed_till_guard/);
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\(org_id::text\|\|':'\|\|loc_id::text\|\|':'\|\|day::text\|\|':Main till'/);
  assert.match(sql, /closed_by uuid not null/);
  assert.match(sql, /revoke all on table public\.club_till_closes from public,anon,authenticated/);
  assert.match(actions, /club_complete_till_close/);
  assert.match(page, /ClubTillClose/);
  assert.match(component, /Variance preview/);
  assert.match(component, /RECENT CLOSES/);
  assert.equal(calculateTillVarianceMinor(1_250, 1_000), 250);
  assert.equal(calculateTillVarianceMinor(800, 1_000), -200);
  assert.equal(calculateTillVarianceMinor(1_000, 1_000), 0);
});

test("service-refund display calculation supports full and bounded unused-credit refunds", () => {
  assert.deepEqual(serviceRefundAllowance(20_000, 10, 10), { eligible: true, refundableMinor: 20_000, remainingUnits: 10 });
  assert.deepEqual(serviceRefundAllowance(20_000, 10, 4), { eligible: true, refundableMinor: 8_000, remainingUnits: 4 });
  assert.equal(serviceUnitsForRefund(20_000, 10, 4, 8_000), 4);
  assert.equal(serviceUnitsForRefund(20_000, 10, 4, 10_000), undefined);
  assert.equal(serviceUnitsForRefund(20_000, 10, 4, 3_000), undefined);
  assert.equal(serviceRefundAllowance(100, 3, 1).refundableMinor, 33);
  assert.equal(serviceUnitsForRefund(100, 3, 1, 33), 1);
  assert.equal(serviceUnitsForRefund(100, 3, 3, 34), 1);
  assert.equal(serviceRefundAllowance(20_000, 10, 0).eligible, false);
  // Expiry is intentionally not used in the allowance: expired but unused
  // purchased units remain unused value that the ledger can reverse.
});

test("service refund RPC locks payment, receipt and credit lots and commits reversals with financial evidence", () => {
  const refund = sql.slice(sql.lastIndexOf("create or replace function public.club_issue_staff_refund"));
  assert.match(refund, /from public\.club_payments where id=p_payment_id for update/);
  assert.match(refund, /from public\.club_orders where id=p\.order_id[\s\S]*for update/);
  assert.match(refund, /club_capability_allowed\(p\.organisation_id,auth\.uid\(\),'refunds\.issue'\)/);
  assert.match(refund, /for update loop/);
  assert.match(refund, /remaining_quantity=remaining_quantity-per_lot/);
  assert.match(refund, /club_refund_service_credit_reversals/);
  assert.match(refund, /entry_type,amount_delta_minor,balance_after_minor/);
  assert.match(refund, /refund:'\|\|r\.id::text/);
  assert.match(refund, /p\.method not in \('cash','balance'\).*Complete the provider refund first/s);
  assert.match(refund, /service_units_reversed/);
  assert.match(refund, /idempotency_key/);
  assert.match(refundView, /unused/);
  assert.match(refundView, /Refund to Balance/);
  assert.match(refundView, /Provider refund reference/);
});

test("physical POS refund branch remains available and deployment manifest includes only the forward migration", () => {
  assert.match(sql, /if service_count>0 then/);
  assert.match(sql, /if service_count<>1 or retail_count<>0 then/);
  assert.match(sql, /payment\.refund_issued/);
  const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
  assert.ok(manifest.indexOf("2026-12-09-club-staff-refunds.sql") < manifest.indexOf("2026-12-10-club-till-close-and-service-refunds.sql"));
});
