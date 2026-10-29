import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { madhouseCatalogue, madhouseMembershipRules, membershipSupportsAdditionalPerson } from "../lib/madhouse-catalogue";

const sql = readFileSync("supabase/migrations/2027-01-25-family-shared-memberships-and-billing.sql", "utf8");
const publicJoin = readFileSync("app/join/[clubSlug]/page.tsx", "utf8");
const household = readFileSync("components/club-membership-household.tsx", "utf8");

test("Family is contact-only publicly and staff-manageable as a shared product", () => {
  const family = madhouseCatalogue.find(product => product.name === "Family Membership")!;
  assert.equal(family.sellable, false);
  assert.equal(family.pricingOnRequest, true);
  assert.equal(membershipSupportsAdditionalPerson(family.name), true);
  assert.deepEqual(madhouseMembershipRules[family.name].defaultHouseholdCompositions, ["2_adults_1_child", "1_adult_2_children"]);
  assert.match(publicJoin, /Contact us for pricing and details/);
  assert.match(publicJoin, /not available for automatic online checkout/);
  assert.match(sql, /pricing_on_request=true/);
  assert.match(household, /Covered person role/);
  assert.match(sql, /shared_membership boolean/);
  assert.match(sql, /Household controls are only available for shared memberships/);
  assert.match(sql, /values\(family_product,org,'madhouse\.membership\.family\.v1',null,true\)/);
});

test("shared import creates one contract, membership, payer and obligation without provider actions", () => {
  const baseBilling = readFileSync("supabase/migrations/2026-09-28-club-membership-billing-dunning.sql", "utf8");
  assert.match(sql, /shared-member-import:/);
  assert.match(sql, /responsible_payer_customer_id/);
  assert.match(sql, /unique\(organisation_id,external_contract_reference\)/);
  assert.match(baseBilling, /unique \(organisation_id, membership_id\)/);
  assert.match(sql, /provider_reconciliation_state='pending'/);
  assert.match(sql, /not \(coalesce\(contract\.imported,false\) and contract\.provider_reconciliation_state='pending'\)/);
  assert.match(sql, /club_reconcile_imported_shared_contract/);
  assert.doesNotMatch(sql, /stripe\.subscriptions|payment_intents|gocardless.*create/i);
});

test("billing tracks pending, failure, retry and recovery while using correct grace", () => {
  const baseBilling = readFileSync("supabase/migrations/2026-09-28-club-membership-billing-dunning.sql", "utf8");
  assert.match(baseBilling, /payment_submitted/);
  assert.match(baseBilling, /payment_failed/);
  assert.match(baseBilling, /retry_scheduled/);
  assert.match(baseBilling, /'recovered'/);
  assert.match(sql, /club_membership_billing_state_history/);
  assert.match(sql, /new\.event_type='payment_submitted'[\s\S]+state='payment_pending'/);
  assert.match(sql, /new\.event_type='payment_failed'[\s\S]+state='failed'/);
  assert.match(sql, /p_failure_at\+interval '7 days'/);
  assert.match(sql, /club_add_billing_working_days\(p_organisation_id,p_failure_at,3\)/);
  assert.match(sql, /extract\(isodow from local_day\)<6/);
  assert.match(sql, /club_billing_non_working_dates/);
  assert.match(sql, /p_as_of>=expiry/);
});

test("first receipt fixes anniversary and recovery projects across every holder", () => {
  const accessProjection = readFileSync("supabase/migrations/2026-12-04-member-pin-qr-access-pass.sql", "utf8");
  assert.match(sql, /club_establish_membership_anniversary/);
  assert.match(sql, /anniversary_established_at is null/);
  assert.match(sql, /source<>'legacy_import'/);
  assert.match(sql, /schedule_source='first_successful_payment'/);
  assert.match(accessProjection, /for h in select c\.id from public\.club_membership_holders/);
  assert.match(accessProjection, /club_suspension_access_projection_refresh/);
  assert.match(sql, /join public\.club_membership_holders h on h\.membership_id=s\.membership_id/);
  assert.match(sql, /g\.membership_id is null or not exists/);
});

test("fixed passes, annual and lifetime protections remain unchanged", () => {
  const cashSafety = readFileSync("supabase/migrations/2026-12-31-cash-membership-period-and-anniversary-safety.sql", "utf8");
  const lifetime = readFileSync("supabase/migrations/2027-01-02-golden-ticket-lifetime-memberships.sql", "utf8");
  assert.match(cashSafety, /Fixed-duration and one-off memberships cannot create monthly billing obligations/);
  assert.match(lifetime, /Golden Ticket lifetime memberships cannot have billing arrangements/);
  assert.doesNotMatch(sql, /Golden Ticket Founding Membership/);
});
