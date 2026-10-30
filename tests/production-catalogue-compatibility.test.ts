import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/deployment/2027-01-24-production-catalogue-compatibility.sql", "utf8");
const serviceSeed = readFileSync("supabase/deployment/2027-01-24-madhouse-service-package-seed.sql", "utf8");
const supersededMigration = readFileSync("supabase/migrations/2027-01-24-madhouse-membership-services-catalogue.sql", "utf8");
const automaticManifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");

test("manual catalogue compatibility script preserves production membership and payment state", () => {
  assert.match(sql, /^begin;/m);
  assert.match(sql, /commit;\s*$/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from) public\.club_products/i);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from) public\.club_product_entitlements/i);
  assert.doesNotMatch(sql, /(?:insert into|update|delete from) public\.club_memberships/i);
  assert.doesNotMatch(sql, /club_membership_(?:billing|shared_contracts|payment_grace)/i);
  assert.doesNotMatch(sql, /STRIPE_(?:FRANCHISE|PRODUCTS_SERVICES)_(?:SECRET_KEY|LIVE_ENABLED|WEBHOOK_SECRET)|gocardless|checkout\.sessions|payment_intents/);
  assert.doesNotMatch(sql, /create or replace function public\.club_guard_membership_holder_limit/);
});

test("manual catalogue compatibility script validates rather than reprices existing products", () => {
  for (const [name, price] of [
    ["Gym Day Pass", 500], ["Week Pass", 1200], ["Standard Monthly", 2700],
    ["Concession Monthly", 2200], ["Yearly Membership", 25000], ["Couples Membership", 4500],
  ] as const) {
    assert.match(sql, new RegExp(`${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}[\\s\\S]{0,500}?${price}`));
  }
  assert.match(sql, /892195bf-2f53-4580-ad9d-108effbce011/);
  assert.match(sql, /p\.pricing_on_request/);
  assert.match(sql, /raise exception 'Existing Madhouse product does not match its authorised catalogue definition/);
  assert.doesNotMatch(sql, /Off Peak|'Day Pass'|'1 Week Pass'|'Unlimited Gym'|'Unlimited Gym Discount'/);
});

test("manual catalogue compatibility script installs only the remaining January 24 safeguards", () => {
  assert.match(sql, /create table if not exists public\.club_membership_eligibility_verifications/);
  assert.match(sql, /club_verify_membership_eligibility/);
  assert.match(sql, /club_membership_checkout_eligibility/);
  assert.match(sql, /madhouse\.membership\.couple\.v1/);
  assert.match(sql, /madhouse\.membership\.family\.v1/);
  assert.doesNotMatch(sql, /club_guard_membership_holder_limit|payment_grace/);
});

test("separate service seed is organisation scoped, idempotent and creates no charge", () => {
  assert.match(serviceSeed, /^begin;/m);
  assert.match(serviceSeed, /commit;\s*$/);
  assert.match(serviceSeed, /where slug='madhouse-gym'/);
  assert.match(serviceSeed, /if matching=0 then[\s\S]+insert into public\.club_services/);
  assert.match(serviceSeed, /if matching=0 then[\s\S]+insert into public\.club_commerce_products/);
  assert.match(serviceSeed, /on conflict\(commerce_product_id\) do nothing/);
  assert.match(serviceSeed, /club_service_package_membership_required/);
  assert.match(serviceSeed, /club_paid_transformation_entitlements/);
  assert.doesNotMatch(serviceSeed, /insert into public\.club_(?:orders|payments|memberships)/i);
  assert.doesNotMatch(serviceSeed, /checkout\.sessions|payment_intents|provider_charge|STRIPE_[A-Z_]+/);
});

test("superseded January 24 SQL cannot be selected by the automatic deployment manifest", () => {
  assert.match(supersededMigration, /SUPERSEDED FOR PRODUCTION: do not execute this migration/);
  assert.doesNotMatch(automaticManifest, /^supabase\/(?:migrations\/2027-01-24|deployment\/2027-01-24)/m);
});
