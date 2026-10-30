import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasClubCapability } from "@/lib/club-capabilities";

const sql = readFileSync("supabase/migrations/2027-01-27-club-counter-membership-payments.sql", "utf8");

test("counter payments are organisation-scoped, idempotent and non-activating until verification", () => {
  assert.match(sql, /create table public\.club_membership_counter_payments/);
  assert.match(sql, /unique\(organisation_id,idempotency_key\)/);
  assert.match(sql, /foreign key\(product_id,organisation_id\)/);
  assert.match(sql, /foreign key\(customer_id,organisation_id\)/);
  assert.match(sql, /state text not null default 'pending_verification'/);
  const initiation = sql.slice(sql.indexOf("club_initiate_membership_counter_payment"), sql.indexOf("club_verify_membership_counter_payment"));
  assert.doesNotMatch(initiation, /club_assign_membership/);
  assert.match(sql, /result:=public\.club_assign_membership/);
  assert.match(sql, /product\.price_minor<>payment\.amount_minor/);
  assert.match(sql, /payment\.method='cash'.*'cash\.reconcile'/s);
  assert.match(sql, /'counter-payment:'\|\|payment\.id/);
});

test("payment and sensitive Family pricing capabilities are narrowly granted", () => {
  assert.equal(hasClubCapability("owner", "memberships.pricing_sensitive"), true);
  assert.equal(hasClubCapability("gym_admin", "memberships.pricing_sensitive"), false);
  assert.equal(hasClubCapability("gym_staff", "membership_payments.verify"), false);
  assert.equal(hasClubCapability("gym_staff", "membership_payments.verify", [{ capability: "membership_payments.verify", decision: "allow" }]), true);
  assert.match(sql, /arrangement_kind='family'/);
  assert.match(sql, /p_amount_minor<=0/);
  assert.match(sql, /membership\.family_terms_set/);
});

test("payment evidence excludes card data and preserves the Franchise membership boundary", () => {
  assert.doesNotMatch(sql, /card_number|cvv|pan_number/i);
  assert.match(sql, /method in \('cash','bank_transfer','external_card'\)/);
  assert.doesNotMatch(sql, /stripe_secret|stripe\.payment/i);
  assert.match(readFileSync("lib/stripe-routing-policy.ts", "utf8"), /madhouse_franchise/);
});
