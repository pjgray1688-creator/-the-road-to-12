import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryClubRepository } from "../lib/club-repository";

const migration = readFileSync(new URL("../supabase/migrations/2026-09-08-club-commerce-payments-inventory.sql", import.meta.url), "utf8");

test("commerce foundation is organisation-scoped with exact minor-unit money", () => {
  for (const table of ["club_payment_accounts", "club_commerce_products", "club_inventory", "club_orders", "club_order_items", "club_payments", "club_refunds", "club_stock_movements", "club_balance_accounts", "club_balance_entries", "club_stocktakes"]) assert.match(migration, new RegExp(`create table public\\.${table}`));
  assert.match(migration, /sell_price_minor integer/); assert.match(migration, /total_minor integer/); assert.doesNotMatch(migration, /numeric\s*\(/i);
  assert.match(migration, /foreign key \(location_id, organisation_id\)/g);
});

test("commerce uses immutable stock movements and stocktake variance", () => {
  assert.match(migration, /club_stock_movements/); assert.match(migration, /quantity_delta integer not null/); assert.match(migration, /generated always as \(counted_quantity - expected_quantity\)/);
  assert.match(migration, /stocktake_adjustment/); assert.match(migration, /idempotency_key text/);
});

test("payments and balances remain separate, provider-neutral and organisation-bound", () => {
  assert.match(migration, /external_account_reference text/); assert.match(migration, /API keys, secrets/);
  assert.match(migration, /club_payments/); assert.match(migration, /club_refunds/); assert.match(migration, /club_balance_entries/);
  assert.match(migration, /method text not null check/); assert.match(migration, /'cash'/); assert.match(migration, /'balance'/);
  assert.match(migration, /not a transferable universal R12 wallet/); assert.match(migration, /R12 consumer subscriptions use a separate platform-revenue domain/);
});

test("balance credit is staff-controlled and preserves an auditable actor", () => {
  const functionBody = migration.slice(migration.indexOf("create or replace function public.club_credit_balance"), migration.indexOf("create or replace function public.club_spend_balance"));
  assert.match(functionBody, /v_staff:=public\.club_has_active_role\(p_organisation_id,array\['gym_staff','gym_admin','owner'\]\)/);
  assert.match(functionBody, /if not v_staff then raise exception 'Balance credit is not permitted' using errcode='42501'/);
  assert.match(functionBody, /auth\.uid\(\)/);
  assert.doesNotMatch(functionBody, /p_user_id is distinct from auth\.uid/);
});

test("settlement RPCs require full pending orders and balance sales mirror cash stock movements", () => {
  const cash = migration.slice(migration.indexOf("create or replace function public.club_record_cash_payment"), migration.indexOf("create or replace function public.club_credit_balance"));
  const balance = migration.slice(migration.indexOf("create or replace function public.club_spend_balance"), migration.indexOf("create or replace function public.club_adjust_inventory"));
  for (const body of [cash, balance]) { assert.match(body, /v_order\.status<>'pending_payment'/); assert.match(body, /for v_order_item in select \* from public\.club_order_items/); assert.match(body, /movement_type,quantity_delta,order_id,actor_user_id,idempotency_key/); }
  assert.match(balance, /p_amount_minor<>v_order\.total_minor/); assert.match(balance, /method,external_reference,amount_minor/); assert.match(balance, /p_idempotency_key\|\|':'\|\|v_order_item\.id/);
  assert.match(cash, /external_reference=p_idempotency_key/);
});

test("idempotent replays are bound to the original order, caller and customer", () => {
  const order = migration.slice(migration.indexOf("create or replace function public.club_create_commerce_order"), migration.indexOf("create or replace function public.club_record_cash_payment"));
  const cash = migration.slice(migration.indexOf("create or replace function public.club_record_cash_payment"), migration.indexOf("create or replace function public.club_credit_balance"));
  const spend = migration.slice(migration.indexOf("create or replace function public.club_spend_balance"), migration.indexOf("create or replace function public.club_adjust_inventory"));
  assert.match(order, /v_existing\.user_id is distinct from auth\.uid\(\)/); assert.match(order, /v_existing\.customer_id is distinct from p_customer_id/); assert.match(order, /Customer is not associated with caller/); assert.match(order, /Idempotency key conflict/);
  assert.match(cash, /v_existing\.order_id<>v_order\.id/); assert.match(spend, /v_existing\.order_id is distinct from v_order\.id/); assert.match(spend, /v_existing\.account_id<>v_account\.id/); assert.match(spend, /v_existing\.entry_type<>'purchase'/);
});

test("other commerce RPCs retain their trust boundaries", () => {
  const order = migration.slice(migration.indexOf("create or replace function public.club_create_commerce_order"), migration.indexOf("create or replace function public.club_record_cash_payment"));
  const cash = migration.slice(migration.indexOf("create or replace function public.club_record_cash_payment"), migration.indexOf("create or replace function public.club_credit_balance"));
  const spend = migration.slice(migration.indexOf("create or replace function public.club_spend_balance"), migration.indexOf("create or replace function public.club_adjust_inventory"));
  const inventory = migration.slice(migration.indexOf("create or replace function public.club_adjust_inventory"), migration.indexOf("revoke all privileges on table"));
  const catalogue = migration.slice(migration.indexOf("create or replace function public.club_save_commerce_product"), migration.indexOf("create or replace function public.club_create_commerce_order"));
  assert.match(order, /auth\.uid\(\) is null/); assert.match(cash, /gym_staff','gym_admin','owner/); assert.match(spend, /v_order\.user_id is distinct from auth\.uid/); assert.match(inventory, /gym_staff','gym_admin','owner/); assert.match(catalogue, /gym_admin','owner/);
  assert.doesNotMatch(cash, /p_user_id|p_customer_id/); assert.doesNotMatch(inventory, /p_user_id/);
});

test("commerce RLS is read-scoped and aggregate mutation is RPC-only", () => {
  for (const table of ["club_payment_accounts", "club_commerce_products", "club_inventory", "club_orders", "club_order_items", "club_payments", "club_refunds", "club_stock_movements", "club_balance_accounts", "club_balance_entries", "club_stocktakes"]) assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  assert.match(migration, /revoke all privileges on table[\s\S]+from public,anon,authenticated/);
  assert.match(migration, /grant select on table[\s\S]+to authenticated/); assert.doesNotMatch(migration, /grant (?:insert|update|delete) on table public\.club_/i);
  for (const fn of ["club_create_commerce_order", "club_record_cash_payment", "club_credit_balance", "club_spend_balance", "club_adjust_inventory"]) { assert.match(migration, new RegExp(`create or replace function public\\.${fn}`)); assert.match(migration, new RegExp(`grant execute on function[\\s\\S]+${fn}`)); }
  assert.match(migration, /set search_path=pg_catalog,public/); assert.match(migration, /revoke all on function[\s\S]+from public/);
});

test("memory repository keeps commerce operations deterministic and money exact", async () => {
  const repository = new MemoryClubRepository();
  repository.commerceProducts.push({ id: "retail-1", organisationId: "org-madhouse", name: "Protein bar", active: true, stockTracked: true, sellPriceMinor: 350, currency: "GBP", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  const order = await repository.createCommerceOrder({ organisationId: "org-madhouse", channel: "quick_sale", currency: "GBP", items: [{ productId: "retail-1", quantity: 2 }] });
  assert.equal(order.totalMinor, 700); assert.equal(order.items[0].lineTotalMinor, 700);
  const payment = await repository.recordCashPayment(order.id, 700); assert.equal(payment.method, "cash"); assert.equal(repository.orders[0].status, "paid");
});

test("balance spending is organisation-scoped and cannot overspend", async () => {
  const repository = new MemoryClubRepository();
  await assert.rejects(() => repository.creditBalance({ organisationId: "org-madhouse", userId: "user-1", currency: "GBP", amountMinor: 1850 }), /balance_credit_forbidden/);
  const account = await repository.creditBalance({ organisationId: "org-madhouse", userId: "user-1", currency: "GBP", amountMinor: 1850, actorRole: "gym_staff" });
  assert.equal(account.balanceAfterMinor, 1850);
  repository.commerceProducts.push({ id: "retail-2", organisationId: "org-madhouse", name: "Shake", active: true, stockTracked: false, sellPriceMinor: 2000, currency: "GBP", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  const order = await repository.createCommerceOrder({ organisationId: "org-madhouse", userId: "user-1", channel: "member_app", currency: "GBP", items: [{ productId: "retail-2", quantity: 1 }] });
  await assert.rejects(() => repository.spendBalance(order.id, 1, "spend-wrong"), /balance_amount_invalid/);
  assert.equal(repository.balanceAccounts[0].balanceMinor, 1850); assert.equal(repository.orders[0].status, "pending_payment");
  await assert.rejects(() => repository.spendBalance(order.id, 2000, "spend-insufficient"), /insufficient_balance/);
  assert.equal(repository.balanceAccounts[0].balanceMinor, 1850); assert.equal(repository.orders[0].status, "pending_payment");
  await repository.creditBalance({ organisationId: "org-madhouse", userId: "user-1", currency: "GBP", amountMinor: 150, actorRole: "gym_staff" });
  const settled = await repository.spendBalance(order.id, 2000, "spend-correct");
  assert.equal(settled.amountDeltaMinor, -2000); assert.equal(repository.orders[0].status, "paid");
  assert.equal(repository.stockMovements.length, 0);
  await assert.rejects(() => repository.spendBalance(order.id, 2000, "spend-other"), /order_not_awaiting_settlement/);
});

test("memory cash settlement is full-only, idempotent and records stock sale movements", async () => {
  const repository = new MemoryClubRepository();
  repository.commerceProducts.push({ id: "stock-1", organisationId: "org-madhouse", name: "Drink", active: true, stockTracked: true, sellPriceMinor: 500, currency: "GBP", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  const order = await repository.createCommerceOrder({ organisationId: "org-madhouse", locationId: "loc-carlton", channel: "quick_sale", currency: "GBP", items: [{ productId: "stock-1", quantity: 2 }] });
  await assert.rejects(() => repository.recordCashPayment(order.id, 1), /payment_amount_invalid/);
  assert.equal(order.status, "pending_payment");
  const payment = await repository.recordCashPayment(order.id, 1000, "cash-1");
  assert.equal(payment.method, "cash"); assert.equal(repository.stockMovements.length, 1); assert.equal(repository.stockMovements[0].quantityDelta, -2);
  assert.equal(await repository.recordCashPayment(order.id, 1000, "cash-1"), payment);
  await assert.rejects(() => repository.recordCashPayment(order.id, 1000, "cash-2"), /order_not_awaiting_settlement/);
  const other = await repository.createCommerceOrder({ organisationId: "org-madhouse", locationId: "loc-carlton", channel: "quick_sale", currency: "GBP", items: [{ productId: "stock-1", quantity: 2 }] });
  await assert.rejects(() => repository.recordCashPayment(other.id, 1000, "cash-1"), /idempotency_conflict/);
});

test("memory order replays preserve caller/customer ownership and reject key collisions", async () => {
  const repository = new MemoryClubRepository();
  repository.commerceProducts.push({ id: "retail-3", organisationId: "org-madhouse", name: "Water", active: true, stockTracked: false, sellPriceMinor: 100, currency: "GBP", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  repository.customers.push({ id: "customer-a", organisationId: "org-madhouse", userId: "user-a", displayName: "A", status: "member", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  repository.customers.push({ id: "customer-b", organisationId: "org-madhouse", userId: "user-b", displayName: "B", status: "member", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  const first = await repository.createCommerceOrder({ organisationId: "org-madhouse", userId: "user-a", customerId: "customer-a", channel: "member_app", currency: "GBP", items: [{ productId: "retail-3", quantity: 1 }], idempotencyKey: "order-key" });
  assert.equal(await repository.createCommerceOrder({ organisationId: "org-madhouse", userId: "user-a", customerId: "customer-a", channel: "member_app", currency: "GBP", items: [{ productId: "retail-3", quantity: 1 }], idempotencyKey: "order-key" }), first);
  await assert.rejects(() => repository.createCommerceOrder({ organisationId: "org-madhouse", userId: "user-b", customerId: "customer-b", channel: "member_app", currency: "GBP", items: [{ productId: "retail-3", quantity: 1 }], idempotencyKey: "order-key" }), /idempotency_conflict/);
  await assert.rejects(() => repository.createCommerceOrder({ organisationId: "org-madhouse", userId: "user-b", customerId: "customer-a", channel: "member_app", currency: "GBP", items: [{ productId: "retail-3", quantity: 1 }] }), /customer_not_owned/);
  const staffOrder = await repository.createCommerceOrder({ organisationId: "org-madhouse", customerId: "customer-b", channel: "staff_checkout", currency: "GBP", items: [{ productId: "retail-3", quantity: 1 }], idempotencyKey: "staff-key" });
  assert.equal(staffOrder.customerId, "customer-b");
});

test("cash, service-credit, initial-charge and promotion foundation is additive and hardened", () => {
  const migration = readFileSync("supabase/migrations/2026-09-09-club-cash-credits-promotions.sql", "utf8");
  for (const table of ["club_cash_declarations", "club_service_credit_accounts", "club_service_credit_entries", "club_membership_initial_charges", "club_promotions", "club_promotion_effects", "club_promotion_redemptions"]) assert.match(migration, new RegExp(`create table public\\.${table}`));
  for (const fn of ["club_declare_cash_payment", "club_reconcile_cash_declaration", "club_grant_service_credit", "club_spend_service_credit", "club_save_membership_initial_charge", "club_save_promotion"]) assert.match(migration, new RegExp(`function public\\.${fn}`));
  assert.match(migration, /alter table public\.club_cash_declarations enable row level security/);
  assert.match(migration, /revoke all on table[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function[\s\S]*to authenticated/);
  assert.match(migration, /p_user_id is distinct from auth\.uid\(\)/);
  assert.match(migration, /club_stock_movements[\s\S]*'sale'/);
  assert.match(migration, /quantity_delta integer not null check \(quantity_delta <> 0\)/);
  assert.match(migration, /percentage_basis_points integer[\s\S]*between 1 and 10000/);
});

test("memory commercial ledgers keep money and service units separate", async () => {
  const repository = new MemoryClubRepository();
  const grant = await repository.grantServiceCredit({ organisationId: "org-madhouse", userId: "user-1", creditKey: "sunbed", unit: "minute", quantity: 100, idempotencyKey: "grant-1" });
  assert.equal(grant.quantityDelta, 100); assert.equal(grant.balanceAfter, 100); assert.equal(repository.balanceAccounts.length, 0);
  const usage = await repository.spendServiceCredit({ accountId: grant.accountId, quantity: 6, idempotencyKey: "use-1" });
  assert.equal(usage.quantityDelta, -6); assert.equal(usage.balanceAfter, 94);
  await assert.rejects(() => repository.spendServiceCredit({ accountId: grant.accountId, quantity: 95, idempotencyKey: "use-2" }), /service_credit_insufficient/);
});
