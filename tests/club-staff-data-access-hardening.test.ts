import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const expandSql = readFileSync("supabase/migrations/2027-01-28-club-staff-data-access-expand.sql", "utf8");
const contractSql = readFileSync("supabase/migrations/2027-01-29-club-staff-data-access-contract.sql", "utf8");
const auditSchema = readFileSync("supabase/migrations/2026-09-13-club-staff-capabilities-audit.sql", "utf8");
const glowGuards = readFileSync("supabase/migrations/2027-01-24-glow-zone-carlton-operations-guards.sql", "utf8");
const sql = expandSql + "\n" + contractSql;
const repository = readFileSync("lib/supabase-club-repository.ts", "utf8");
const contactPage = readFileSync("app/club/members/[userId]/page.tsx", "utf8");
const contactActions = readFileSync("app/club/members/[userId]/actions.ts", "utf8");
const financePage = readFileSync("app/club/payments/page.tsx", "utf8");
const reportPage = readFileSync("app/club/reports/page.tsx", "utf8");
const refundAction = readFileSync("app/club/shop/actions.ts", "utf8");
const shopPage = readFileSync("app/club/shop/page.tsx", "utf8");
const customerRepository = readFileSync("lib/supabase-club-repository.ts", "utf8");

test("authenticated staff receive only operational customer/order/payment columns", () => {
  assert.match(sql, /revoke select on table public\.%I from public,anon,authenticated/);
  assert.match(sql, /grant select \(id,organisation_id,user_id,display_name,email,phone,status,created_at,updated_at,first_name,last_name,preferred_location_id\)\s+on public\.club_customers/);
  assert.doesNotMatch(sql, /grant select\s*\([^)]*(address_line_1|town_city|postcode|date_of_birth|metadata|external_reference|stripe_account_id)/i);
  assert.match(sql, /grant select \(id,order_id,organisation_id,method,amount_minor,currency,status,created_at,updated_at\)\s+on public\.club_payments/);
  assert.match(repository, /from\("club_customers"\)\.select\("id,organisation_id,user_id,display_name,email,phone,preferred_location_id,status,created_at,updated_at"\)/);
});

test("member address is separately capability-gated and emergency access is scoped/audited", () => {
  assert.match(sql, /can_see_address:=public\.club_capability_allowed\(p_organisation_id,auth\.uid\(\),'staff\.permissions_manage'\)/);
  assert.match(sql, /can_edit_address:=public\.club_capability_allowed\(p_organisation_id,auth\.uid\(\),'staff\.permissions_manage'\)/);
  assert.match(sql, /where id=p_customer_id and organisation_id=p_organisation_id/);
  assert.match(sql, /member\.emergency_contact_viewed/);
  assert.match(contactPage, /club_get_member_emergency_contact/);
  assert.match(contactPage, /hasCapability\(context\.organisation\.id, user\.id, "members\.view"\)/);
  assert.match(contactActions, /club_update_member_contact_secure/);
});

test("management finance reports use a finance-gated safe projection", () => {
  assert.match(sql, /not public\.club_capability_allowed\(p_organisation_id,auth\.uid\(\),'finance\.view'\)/);
  assert.match(sql, /'payments',\(select coalesce\(jsonb_agg\(jsonb_build_object\('id',p\.id,'order_id',p\.order_id,'created_at',p\.created_at,'method',p\.method,'amount_minor',p\.amount_minor,'status',p\.status,'stripe_merchant_entity',p\.stripe_merchant_entity\)/);
  assert.doesNotMatch(sql, /'external_reference',p\.external_reference|'stripe_account_id',p\.stripe_account_id|'metadata',p\.metadata/);
  assert.match(financePage, /rpc\("club_list_finance_reconciliation"/);
  assert.match(reportPage, /rpc\("club_list_finance_reconciliation"/);
});

test("refund history is read-only for staff and execution requires approval on server and RPC", () => {
  assert.match(sql, /club_approve_staff_line_refund/);
  assert.match(sql, /'refunds\.approve'/);
  assert.match(sql, /revoke all on function public\.club_issue_staff_refund[\s\S]*?from public,anon,authenticated/);
  assert.match(refundAction, /hasCapability\(value\.organisation\.id, value\.userId, "refunds\.approve"\)/);
  assert.match(refundAction, /rpc\("club_approve_staff_line_refund"/);
  assert.match(shopPage, /canApproveRefund=\{loaded\.canApproveRefund\}/);
  assert.match(shopPage, /select\("id,payment_id,amount_minor,reason,created_at"\)/);
  assert.doesNotMatch(shopPage, /select\([^)]*(external_reference|created_by)[^)]*\).*club_refunds/);
  assert.match(sql, /return result-'external_reference'-'created_by'-'idempotency_key'/g);
});

test("migration is transactional, fail-closed, idempotent for emergency columns, and does not edit customer rows", () => {
  assert.match(sql, /\nbegin;\n/);
  assert.match(sql, /raise exception 'Required authorization or workflow RPC is missing; no permissions have been changed'/);
  assert.match(sql, /add column if not exists emergency_contact_name text/);
  assert.match(sql, /add column if not exists emergency_contact_phone text/);
  assert.match(sql, /RLS must be enabled on public\.% before column grants can be narrowed/);
  const declarativeMigration = sql.split("-- Home-address access remains a separate")[0];
  assert.doesNotMatch(declarativeMigration, /update public\.club_customers|delete from public\.club_customers/i);
  assert.doesNotMatch(sql, /update public\.club_customers\s+set\s+date_of_birth/i);
  assert.match(sql, /commit;\s*$/);
});

test("staff-facing SECURITY DEFINER reads enforce authentication, capability and tenant-scoped identifiers", () => {
  assert.match(sql, /club_get_member_contact_secure[\s\S]*?auth\.uid\(\) is null or not public\.club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.create'\)/);
  assert.match(sql, /club_get_member_emergency_contact[\s\S]*?auth\.uid\(\) is null or not public\.club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.view'\)/);
  assert.match(sql, /where id=p_customer_id and organisation_id=p_organisation_id/);
  assert.match(sql, /club_list_finance_reconciliation[\s\S]*?auth\.uid\(\) is null or not public\.club_capability_allowed\(p_organisation_id,auth\.uid\(\),'finance\.view'\)/);
  assert.match(sql, /club_approve_staff_refund[\s\S]*?'refunds\.approve'/);
  assert.match(sql, /club_approve_staff_line_refund[\s\S]*?'refunds\.approve'/);
  assert.match(sql, /revoke all on function public\.club_get_member_contact\(uuid,uuid\),public\.club_update_member_contact\(uuid,uuid,text,text,text,text,text\) from public,anon,authenticated/);
  assert.match(sql, /revoke all on function public\.club_glow_record_age_verification\(uuid,uuid,date,text\) from public,anon,authenticated/);
});

test("member-facing Glow Zone account RPC is self-scoped and Glow verification stores no DOB", () => {
  assert.match(sql, /club_glow_my_customer_account[\s\S]*?user_id=auth\.uid\(\)/);
  assert.match(sql, /club_glow_record_age_confirmation[\s\S]*?verified_by=excluded\.verified_by/);
  assert.match(sql, /values\(p_organisation_id,p_user_id,null,case when p_is_adult/);
  assert.doesNotMatch(sql, /update public\.club_glow_age_verifications[\s\S]*?date_of_birth=null/);
  assert.match(sql, /club_glow_complete_customer_details\(uuid,text,text,text,date\) from public,anon,authenticated/);
  assert.doesNotMatch(sql, /'date_of_birth',c\.date_of_birth|'date_of_birth',a\.date_of_birth/);
});

test("safe projections retain the cross-venue operational fields while excluding home address and provider data", () => {
  assert.match(sql, /grant select \(id,organisation_id,user_id,display_name,email,phone,status,created_at,updated_at,first_name,last_name,preferred_location_id\)\s+on public\.club_customers/);
  assert.match(sql, /grant select \(id,organisation_id,location_id,customer_id,user_id,channel,status,currency,subtotal_minor,discount_minor,total_minor,created_at,updated_at\)\s+on public\.club_orders/);
  assert.match(sql, /grant select \(id,payment_id,order_id,organisation_id,amount_minor,reason,created_at\)\s+on public\.club_refunds/);
  assert.doesNotMatch(sql, /grant select\s*\([^)]*(?:address_line_1|address_line_2|town_city|postcode|date_of_birth|payment_account_id|external_reference|metadata|stripe_account_id)/i);
  assert.match(customerRepository, /listCustomers\(organisationId: string\)[\s\S]*?preferred_location_id/);
});

test("EXPAND keeps existing table grants and legacy RPCs callable while secure RPCs are installed", () => {
  assert.match(expandSql, /create or replace function public\.club_get_member_contact_secure/);
  assert.match(expandSql, /create or replace function public\.club_list_finance_reconciliation/);
  assert.doesNotMatch(expandSql, /revoke select on table public\.%I/);
  assert.doesNotMatch(expandSql, /revoke all on function public\.club_get_member_contact\(uuid,uuid\)/);
  assert.doesNotMatch(expandSql, /revoke all on function public\.club_issue_staff_refund\(/);
  assert.match(expandSql, /grant execute on function public\.club_get_member_contact_secure/);
});

test("CONTRACT is transactional, checks policies and secure RPCs first, then narrows grants", () => {
  assert.match(contractSql, /^-- CONTRACT[\s\S]*?begin;/);
  assert.match(contractSql, /Required organisation-scoped policy %\.% is missing; no grants were changed/);
  assert.match(contractSql, /Required secure application RPC is missing; no grants were changed/);
  assert.match(contractSql, /revoke select on table public\.%I from public,anon,authenticated/);
  assert.match(contractSql, /grant select \(id,organisation_id,user_id,display_name,email,phone,status,created_at,updated_at,first_name,last_name,preferred_location_id\)/);
  assert.match(contractSql, /revoke all on table public\.club_glow_age_verifications from public,anon,authenticated/);
  assert.match(contractSql, /commit;\s*$/);
});

test("ordinary staff retain operational access while address, finance and refunds stay capability-gated", () => {
  assert.match(sql, /club_get_member_emergency_contact[\s\S]*?members\.view[\s\S]*?club_has_active_role\(p_organisation_id,array\['gym_staff','gym_admin','owner','trainer'\]\)/);
  assert.match(sql, /can_see_address:=public\.club_capability_allowed\(p_organisation_id,auth\.uid\(\),'staff\.permissions_manage'\)/);
  assert.match(sql, /club_list_finance_reconciliation[\s\S]*?finance\.view/);
  assert.match(sql, /club_approve_staff_refund[\s\S]*?refunds\.approve/);
  assert.match(sql, /club_approve_staff_line_refund[\s\S]*?refunds\.approve/);
});

test("member, anonymous and cross-organisation boundaries remain enforced", () => {
  assert.match(contractSql, /from public,anon,authenticated/);
  assert.match(contractSql, /to authenticated/);
  assert.match(sql, /where id=p_customer_id and organisation_id=p_organisation_id/);
  assert.match(sql, /club_glow_my_customer_account[\s\S]*?user_id=auth\.uid\(\)/);
  assert.match(sql, /p_location_id is not null and not exists\(select 1 from public\.club_locations where id=p_location_id and organisation_id=p_organisation_id\)/);
  assert.match(sql, /club_glow_carlton_staff_allowed\(p_organisation_id\)/);
});

test("new application uses only additive secure RPC names during the compatibility window", () => {
  assert.match(expandSql, /create or replace function public\.club_record_cash_payment_secure/);
  assert.match(expandSql, /create or replace function public\.club_list_madhouse_apparel_orders_secure/);
  assert.match(expandSql, /create or replace function public\.club_glow_scan_session_request_secure/);
  assert.match(expandSql, /create or replace function public\.club_list_customer_billing_secure/);
  assert.match(repository, /rpc\("club_record_cash_payment_secure"/);
  assert.match(readFileSync("app/club/website-shop/orders/page.tsx", "utf8"), /rpc\("club_list_madhouse_apparel_orders_secure"/);
  assert.match(readFileSync("app/club/sunbeds/actions.ts", "utf8"), /rpc\("club_glow_scan_session_request_secure"/);
  assert.match(readFileSync("app/club/members/customer/[customerId]/page.tsx", "utf8"), /rpc\("club_list_customer_billing_secure"/);
  assert.match(contractSql, /revoke all on function public\.club_record_cash_payment\(uuid,integer,text\)/);
});

test("all authenticated direct reads of protected tables fit the CONTRACT projections", () => {
  assert.match(repository, /from\("club_members"\)\.select\("id,organisation_id,user_id,role,active,created_at,preferred_location_id"\)/);
  assert.match(repository, /from\("club_customers"\)\.select\("id,organisation_id,user_id,display_name,email,phone,preferred_location_id,status,created_at,updated_at"\)/);
  assert.match(repository, /from\("club_orders"\)\.select\("id,organisation_id,location_id,customer_id,user_id,channel,status,currency,subtotal_minor,discount_minor,total_minor,created_at,updated_at,club_order_items\(/);
  assert.match(shopPage, /club_orders"\)\.select\("id,created_at,total_minor,currency,status,location_id,customer_id,club_customers\(display_name\),club_order_items\(id,product_name,quantity,line_total_minor,stock_tracked\),club_payments\(id,method,amount_minor,currency,status\)/);
  assert.match(shopPage, /from\("club_refunds"\)\.select\("id,payment_id,amount_minor,reason,created_at"\)/);
});


test("EXPAND preflight checks pre-existing dependencies, never its own later RPCs", () => {
  const preflight = expandSql.slice(0, expandSql.indexOf("-- Home-address access remains a separate"));
  assert.doesNotMatch(preflight, /to_regprocedure\('public\.club_list_customer_billing_secure\(/);
  assert.match(expandSql, /create or replace function public\.club_list_customer_billing_secure\(/);
  assert.match(preflight, /club_glow_session_requests','token_hash/);
  assert.match(preflight, /club_service_credit_lots','remaining_quantity/);
  assert.match(preflight, /club_location_service_hours','service_key/);
  assert.match(preflight, /club_members','active/);
  assert.match(preflight, /auth\.uid\(\)/);
  assert.match(preflight, /table_schema='auth' and c\.table_name='users'/);
});

test("Glow age audit matches the deployed audit schema and records the authenticated staff role", () => {
  assert.match(auditSchema, /actor_user_id uuid not null[^,]*, actor_role text, action text not null/);
  const start = expandSql.indexOf("create or replace function public.club_glow_record_age_confirmation(");
  const end = expandSql.indexOf("create or replace function public.club_glow_age_status_secure(", start);
  const ageRpc = expandSql.slice(start, end);
  assert.match(ageRpc, /select role into actor_role from public\.club_members where organisation_id=p_organisation_id and user_id=auth\.uid\(\) and active/);
  assert.match(ageRpc, /actor_role is null then raise exception/);
  assert.match(ageRpc, /insert into public\.club_audit_events\(organisation_id,actor_user_id,actor_role,action,target_type,target_id,metadata\)/);
  assert.match(ageRpc, /p_method is null/);
});

test("new SECURITY DEFINER RPCs revoke default and prior direct execution grants", () => {
  const guardedFunctions = [
    ["club_get_member_contact_secure", "uuid,uuid"],
    ["club_update_member_contact_secure", "uuid,uuid,text,text,text,text,text"],
    ["club_get_member_emergency_contact", "uuid,uuid"],
    ["club_list_finance_reconciliation", "uuid,timestamptz,timestamptz,uuid"],
    ["club_approve_staff_refund", "uuid,integer,text,text,text"],
    ["club_approve_staff_line_refund", "uuid,jsonb,text,text,text"],
    ["club_record_cash_payment_secure", "uuid,integer,text"],
    ["club_list_madhouse_apparel_orders_secure", "uuid"],
    ["club_glow_record_age_confirmation", "uuid,uuid,boolean,text"],
    ["club_glow_age_status_secure", "uuid,uuid"],
    ["club_glow_ensure_customer_secure", "uuid"],
    ["club_glow_complete_customer_details_secure", "uuid,text,text,text"],
    ["club_glow_my_customer_account_secure", "uuid"],
    ["club_glow_scan_session_request_secure", "uuid,text"],
    ["club_list_customer_billing_secure", "uuid,uuid"],
  ];
  for (const [name, signature] of guardedFunctions) {
    assert.ok(expandSql.includes(`revoke all on function public.${name}(${signature}) from public,anon,authenticated;`), `${name} must revoke PUBLIC, anon, and prior authenticated grants`);
  }
  assert.match(expandSql, /club_glow_effective_age_status\(uuid,uuid\) from public,anon,authenticated/);
  assert.match(expandSql, /club_glow_effective_age_status\(p_organisation_id uuid,p_user_id uuid\)[\s\S]*?security invoker/);
  assert.doesNotMatch(expandSql, /grant execute on function public\.club_glow_effective_age_status/);
});

test("sensitive SECURITY DEFINER RPCs validate caller identity and organisation scope", () => {
  const body = (name: string, nextName: string) => {
    const start = expandSql.indexOf(`create or replace function public.${name}(`);
    const end = nextName ? expandSql.indexOf(`create or replace function public.${nextName}(`, start) : expandSql.length;
    assert.ok(start >= 0 && end > start, `expected function boundaries for ${name}`);
    return expandSql.slice(start, end);
  };
  assert.match(body("club_get_member_contact_secure", "club_update_member_contact_secure"), /auth\.uid\(\) is null[\s\S]*?club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.create'\)[\s\S]*?organisation_id=p_organisation_id and user_id=p_user_id/);
  assert.match(body("club_glow_scan_session_request_secure", "club_list_customer_billing_secure"), /club_glow_carlton_staff_allowed\(p_organisation_id\)[\s\S]*?where organisation_id=p_organisation_id and token_hash=/);
  assert.match(glowGuards, /club_glow_carlton_staff_allowed[\s\S]*?auth\.uid\(\) is not null[\s\S]*?club_capability_allowed\(p_organisation_id, auth\.uid\(\), 'services\.manage'\)/);
  const billing = body("club_list_customer_billing_secure", "");
  assert.match(billing, /obligation\.organisation_id=p_organisation_id[\s\S]*?auth\.uid\(\) is not null[\s\S]*?club_capability_allowed\(p_organisation_id,auth\.uid\(\),'payments\.take'\)/);
  const apparel = body("club_list_madhouse_apparel_orders_secure", "club_glow_effective_age_status");
  assert.match(apparel, /p_organisation_id<>'fa44592a-1593-4ad3-a621-63a4a4bcbceb'[\s\S]*?club_capability_allowed\(p_organisation_id,auth\.uid\(\),'commerce\.pricing_manage'\)/);
});

test("Apparel order RPC returns an explicit field allowlist, not whole-row JSON", () => {
  const start = expandSql.indexOf("create or replace function public.club_list_madhouse_apparel_orders_secure(");
  const end = expandSql.indexOf("-- New Glow Zone confirmations", start);
  const apparelRpc = expandSql.slice(start, end);
  assert.doesNotMatch(apparelRpc, /to_jsonb\(\s*[odia]\s*\)/i);
  assert.match(apparelRpc, /'order',jsonb_build_object\([\s\S]*?'total_minor',o\.total_minor/);
  assert.match(apparelRpc, /'details',jsonb_build_object\([\s\S]*?'delivery_address',d\.delivery_address/);
  assert.doesNotMatch(apparelRpc, /confirmation_token_hash|stripe_checkout_session_id|payment_account_id|external_reference|metadata/);
  assert.doesNotMatch(apparelRpc, /'details',to_jsonb\(d\)/);
});
