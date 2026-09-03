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
  const account = await repository.creditBalance({ organisationId: "org-madhouse", userId: "user-1", currency: "GBP", amountMinor: 1850 });
  assert.equal(account.balanceAfterMinor, 1850);
  repository.commerceProducts.push({ id: "retail-2", organisationId: "org-madhouse", name: "Shake", active: true, stockTracked: false, sellPriceMinor: 2000, currency: "GBP", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
  const order = await repository.createCommerceOrder({ organisationId: "org-madhouse", channel: "member_app", currency: "GBP", items: [{ productId: "retail-2", quantity: 1 }] });
  await assert.rejects(() => repository.spendBalance(order.id, 2000, "spend-1"), /insufficient_balance/);
});
