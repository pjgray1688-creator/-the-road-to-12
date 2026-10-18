import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-12-31-cash-membership-period-and-anniversary-safety.sql", "utf8");
const fixture = readFileSync("tests/sql/member-household-billing-lifecycle.sql", "utf8");
const action = readFileSync("app/club/shop/actions.ts", "utf8");
const component = readFileSync("components/club-membership-cash-payment.tsx", "utf8");

test("cash settlement records received date, scheduled billing period and paid-through date separately", () => {
  assert.match(migration, /drop constraint if exists club_membership_billing_arrangement_payment_method_family_check/);
  assert.match(migration, /drop constraint if exists club_membership_billing_arrangements_payment_method_family_chec/);
  assert.match(migration, /drop constraint if exists club_member_billing_arrangement_method_family_check/);
  assert.match(migration, /add constraint club_member_billing_arrangement_method_family_check\s+check \(payment_method_family in \('direct_debit','recurring_card','cash','other'\)\)/);
  assert.match(migration, /add column if not exists billing_period_start date/);
  assert.match(migration, /add column if not exists billing_period_end date/);
  assert.match(migration, /receipt_date<>p_receipt_date/);
  assert.match(migration, /billing_period_start<>p_billing_period_start/);
  assert.match(migration, /paid_through_date<>p_paid_through_date/);
  assert.match(migration, /expected_start:.*coverage_start_at.*next_due_at/s);
  assert.match(migration, /membership\.cash_payment_verified/);
  assert.match(migration, /billingPeriodStart/);
  assert.match(action, /p_billing_period_start: input\.billingPeriodStart/);
  assert.match(component, /Billing period starts/);
  assert.match(component, /Billing period ends/);
  assert.match(component, /Paid through/);
  assert.match(component, /Date received/);
});

test("cash payment cannot reset anniversary from receipt time or create renewals for inactive memberships", () => {
  const cashSettlement = migration.slice(
    migration.indexOf("create or replace function public.club_record_membership_cash_payment"),
    migration.indexOf("revoke all on function public.club_record_membership_cash_payment"),
  );
  assert.match(cashSettlement, /club_membership_anniversary\(a\.next_due_at/);
  assert.match(cashSettlement, /membership_row\.status='active'.*a\.state='active'/s);
  assert.match(cashSettlement, /product_billing='recurring'/);
  assert.doesNotMatch(cashSettlement, /next_due:=.*p_receipt_date|next_due:=.*now\(\)/);
  assert.match(migration, /product_billing<>'recurring' or product_duration_days in \(1,7\)/);
  assert.match(migration, /product_billing='recurring' and coalesce\(product_duration_days,0\) not in \(1,7\)/);
  assert.match(migration, /fixed-duration and one-off memberships cannot create monthly billing obligations/i);
  assert.match(fixture, /cash receipt reset household renewal schedule from the received date/i);
  assert.match(fixture, /Expired and cancelled cash memberships/);
  assert.match(fixture, /<>1 then raise exception 'Expired cash settlement created another period obligation'/);
});

test("synthetic PostgreSQL lifecycle fixture covers household recovery, duplicate cash, EOM and fixed passes", () => {
  for (const phrase of [
    "cash-early-jan",
    "cash-on-time-feb",
    "cash-late-mar",
    "2024-02-29",
    "2024-03-31",
    "Day pass created a monthly obligation arrangement",
    "Week pass created a monthly obligation arrangement",
    "household-cash-recovery",
    "Expired and cancelled cash memberships",
    "rollback;",
  ]) assert.ok(fixture.includes(phrase), `household lifecycle fixture is missing ${phrase}`);
});
