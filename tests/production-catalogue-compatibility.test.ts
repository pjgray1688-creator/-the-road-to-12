import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/deployment/2027-01-24-production-catalogue-compatibility.sql", "utf8");

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
    ["Day Pass", 500], ["1 Week Pass", 1200], ["Unlimited Gym", 2700],
    ["Off Peak", 1499], ["Unlimited Gym Discount", 2200], ["Yearly Membership", 27500],
    ["Couples Membership", 4500], ["Transformation Bronze", 25000],
    ["Transformation Silver", 40000], ["Transformation Gold", 52500], ["10 PT Session Block", 20000],
  ] as const) {
    assert.match(sql, new RegExp(`${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}[\\s\\S]{0,500}?${price}`));
  }
  assert.match(sql, /892195bf-2f53-4580-ad9d-108effbce011/);
  assert.match(sql, /p\.pricing_on_request/);
  assert.match(sql, /raise exception 'Existing Madhouse product does not match its authorised catalogue definition/);
});

test("manual catalogue compatibility script installs only the remaining January 24 safeguards", () => {
  assert.match(sql, /create table if not exists public\.club_membership_eligibility_verifications/);
  assert.match(sql, /create table if not exists public\.club_commerce_package_rules/);
  assert.match(sql, /club_verify_membership_eligibility/);
  assert.match(sql, /club_membership_checkout_eligibility/);
  assert.match(sql, /club_service_package_membership_required/);
  assert.match(sql, /club_paid_transformation_entitlements/);
  assert.match(sql, /club_membership_access_window_guard/);
  assert.match(sql, /madhouse\.membership\.couple\.v1/);
  assert.match(sql, /madhouse\.membership\.family\.v1/);
});
