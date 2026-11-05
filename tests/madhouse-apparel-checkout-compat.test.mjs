import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-11-05-madhouse-apparel-checkout-compat.sql", "utf8");
const commerce = readFileSync("supabase/migrations/2026-09-08-club-commerce-payments-inventory.sql", "utf8");
const attempts = readFileSync("supabase/migrations/2026-09-27-club-payment-attempts-split-tender.sql", "utf8");
const apparel = readFileSync("supabase/migrations/2026-11-04-madhouse-apparel-orders.sql", "utf8");
const merchant = readFileSync("supabase/migrations/2027-01-12-two-stripe-merchant-isolation.sql", "utf8");
const route = readFileSync("app/api/public/madhouse-apparel/checkout/route.ts", "utf8");

test("checkout order and attempt values comply with the commerce table checks", () => {
  assert.match(commerce, /channel text not null check \(channel in \([^)]*'web'[^)]*\)\)/);
  assert.match(commerce, /status text not null default 'draft' check \(status in \([^)]*'pending_payment'[^)]*\)\)/);
  assert.match(attempts, /status text not null default 'pending' check \(status in \([^)]*'pending'[^)]*\)\)/);
  assert.match(attempts, /external_method text check \(external_method is null or external_method in \([^)]*'card'[^)]*\)\)/);
  assert.match(apparel, /values\(org,null,'web','pending_payment','GBP'/);
  assert.match(apparel, /values\(org,order_row\.id,'pending','card'/);
});

test("compatibility migration fills only missing apparel snapshot and Products & Services columns", () => {
  assert.match(migration, /add column if not exists website_public_slug text/i);
  assert.match(migration, /add column if not exists discount_quantity integer not null default 0/i);
  assert.match(migration, /add column if not exists stripe_merchant_entity text/i);
  assert.match(migration, /add column if not exists stripe_account_id text/i);
  assert.match(migration, /check \(stripe_merchant_entity is null or stripe_merchant_entity='madhouse_products_services'\)/i);
  assert.match(migration, /create unique index if not exists club_payment_attempts_stripe_session_uq/i);
  assert.doesNotMatch(migration, /madhouse_franchise|gocardless/i);
});

test("the Apparel RPC's Stripe-attempt fields are absent from the base schema and added by the repair", () => {
  assert.match(apparel, /insert into public\.club_payment_attempts\([^)]*stripe_merchant_entity/s);
  assert.match(apparel, /update public\.club_payment_attempts set stripe_checkout_session_id/s);
  assert.doesNotMatch(attempts, /stripe_merchant_entity|stripe_checkout_session_id/);
  assert.match(merchant, /alter table public\.club_payment_attempts[\s\S]*?add column if not exists stripe_merchant_entity/);
  assert.match(migration, /add column if not exists stripe_merchant_entity text/);
  assert.match(migration, /add column if not exists stripe_checkout_session_id text/);
});

test("checkout diagnostics log a safe SQLSTATE and stage without raw database messages", () => {
  assert.match(route, /class CheckoutDatabaseError/);
  assert.match(route, /sqlstate: code/);
  assert.match(route, /stage,\s*errorType:/);
  assert.doesNotMatch(route, /console\.(?:error|warn)\([^\n]*error\.message/);
});
