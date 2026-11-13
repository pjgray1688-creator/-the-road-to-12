import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ordersSql=readFileSync("supabase/migrations/2026-11-13-club-management-orders-external-payments.sql","utf8");
const reportsSql=readFileSync("supabase/migrations/2026-11-13-club-finance-revenue-breakdowns.sql","utf8");
const orderUi=readFileSync("components/club-management-orders.tsx","utf8");
const actions=readFileSync("app/club/shop/actions.ts","utf8");
const finance=readFileSync("app/club/payments/page.tsx","utf8");

test("management order RPC is capability, organisation and venue scoped",()=>{
  const create=ordersSql.slice(ordersSql.indexOf("function public.club_management_create_order_secure"),ordersSql.indexOf("create or replace function public.club_management_confirm_order_secure"));
  assert.match(create,/club_capability_allowed\(p_organisation_id,auth\.uid\(\),'finance\.manage'\)/);
  assert.match(create,/club_location_authorized\(p_organisation_id,p_location_id\)/);
  assert.match(create,/c\.id=p_customer_id and c\.organisation_id=p_organisation_id/);
  assert.match(create,/club_create_commerce_order/);
  assert.match(create,/club_evaluate_commerce_promotions/);
  assert.match(create,/status='draft'/);
  assert.doesNotMatch(create,/to_jsonb\(v_order\)/);
});

test("draft confirmation reserves stock only after manager review",()=>{
  const confirm=ordersSql.slice(ordersSql.indexOf("function public.club_management_confirm_order_secure"),ordersSql.indexOf("create or replace function public.club_management_record_order_payment_secure"));
  assert.match(confirm,/club_capability_allowed\(p_organisation_id,auth\.uid\(\),'finance\.manage'\)/);
  assert.match(confirm,/club_reserve_order_stock/);
  assert.match(confirm,/status='pending_payment'/);
  assert.match(orderUi,/Confirm order/);
});

test("external payment ledger prevents over-allocation, duplicate allocation and premature fulfilment",()=>{
  const record=ordersSql.slice(ordersSql.indexOf("function public.club_management_record_order_payment_secure"),ordersSql.indexOf("create or replace function public.club_management_verify_order_payment_secure"));
  const verify=ordersSql.slice(ordersSql.indexOf("function public.club_management_verify_order_payment_secure"),ordersSql.indexOf("create or replace function public.club_management_cancel_order_secure"));
  assert.match(ordersSql,/club_payments_management_idempotency_uq/);
  assert.match(record,/v_order\.total_minor-v_reserved/);
  assert.match(record,/if p_method='cash' then[\s\S]*?else[\s\S]*?club_payment_accounts/);
  assert.match(record,/purpose='madhouse_products_services'/);
  assert.match(record,/case when p_method='cash' then 'paid' else 'pending' end/);
  assert.match(record,/case when p_method='cash' then 'confirmed' else 'awaiting_verification' end/);
  assert.match(verify,/club_capability_allowed\(p_organisation_id,auth\.uid\(\),'finance\.manage'\)/);
  assert.match(verify,/v_paid=v_order\.total_minor/);
  assert.match(verify,/club_finalize_paid_order/);
  assert.match(record,/club_finalize_paid_order/);
  assert.doesNotMatch(record,/stripe|gocardless/i);
  assert.match(orderUi,/pending management verification/);
});

test("order cancellation refuses any receipt or active integrated attempt",()=>{
  const cancel=ordersSql.slice(ordersSql.indexOf("function public.club_management_cancel_order_secure"),ordersSql.indexOf("create or replace function public.club_management_list_orders_secure"));
  assert.match(cancel,/status in \('paid','pending'\)/);
  assert.match(cancel,/club_payment_attempts/);
  assert.match(cancel,/club_audit_events/);
});

test("management customer creation is audited and never creates or links an auth user",()=>{
  const create=ordersSql.slice(ordersSql.indexOf("function public.club_management_create_customer_secure"),ordersSql.indexOf("revoke all on function public.club_management_create_customer_secure"));
  assert.match(create,/finance\.manage/);
  assert.match(create,/members\.create/);
  assert.match(create,/pg_advisory_xact_lock/);
  assert.match(create,/lower\(c\.email\)=v_email/);
  assert.match(create,/club_create_customer\(p_organisation_id,null/);
  assert.match(create,/club_audit_events/);
  assert.doesNotMatch(create,/auth\.admin|auth\.users|club_link_customer_user/);
  assert.match(actions,/club_management_create_customer_secure/);
});

test("payment receiving accounts are management-only and fixed to Products & Services",()=>{
  assert.match(ordersSql,/club_management_configure_payment_account_secure/);
  assert.match(ordersSql,/purpose='madhouse_products_services'/);
  assert.match(ordersSql,/finance\.manage/);
  assert.match(ordersSql,/revoke all on function public\.club_management_configure_payment_account_secure/);
  assert.match(ordersSql,/grant execute on function public\.club_management_configure_payment_account_secure.*to authenticated/);
});

test("product category snapshots preserve historical unknowns as Uncategorised",()=>{
  assert.match(reportsSql,/reporting_category text not null default 'uncategorized'/);
  assert.match(reportsSql,/new\.reporting_category:=coalesce\(new\.reporting_category,'uncategorized'\)/);
  assert.match(reportsSql,/club_snapshot_commerce_reporting_category/);
  assert.match(reportsSql,/coalesce\(i\.reporting_category,'uncategorized'\)/);
  assert.match(reportsSql,/historical_uncategorised_remains_uncategorised/);
  for(const category of ["pt_transformation","apparel","supplements","food_drink_consumables","classes","other_products_services","uncategorized"]) assert.ok(reportsSql.includes(category));
});

test("finance reporting distinguishes balance spending, top-ups and point-in-time liability",()=>{
  assert.match(reportsSql,/club_list_finance_madhouse_balance_secure/);
  assert.match(reportsSql,/entry_type='purchase'/);
  assert.match(reportsSql,/entry_type='top_up'/);
  assert.match(reportsSql,/unspent_minor/);
  assert.match(reportsSql,/venue_scoped',false/);
  assert.match(finance,/MADHOUSE BALANCE/);
  assert.match(finance,/not new cash income/);
  assert.match(finance,/not profit/);
});
