import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { madhouseCatalogue, materialiseCatalogueProduct } from "../lib/madhouse-catalogue";
import { evaluatePayPalPayIn3Eligibility, PAYPAL_PAY_IN_3_PRODUCT_CODES, paypalPayIn3EnvironmentReadiness, paypalPayIn3FeatureEnabled } from "../lib/paypal-pay-in-3";

const migration = readFileSync("supabase/migrations/2027-01-03-paypal-pay-in-3-checkout-foundation.sql", "utf8");
const action = readFileSync("app/club/join/paypal-actions.ts", "utf8");
const validReadiness = {
  featureEnabled: true, clientIdConfigured: true, secretConfigured: true, buyerEligible: true,
  merchant: { legalEntityNumber: "17383077", merchantAccountId: "merchant-franchise", paypalApproved: true, accountantApproved: true, enabled: true },
};
const product = (name: string) => {
  const definition = madhouseCatalogue.find(item => item.name === name);
  assert.ok(definition);
  return materialiseCatalogueProduct(definition, "madhouse");
};

test("only canonical transformation tiers and annual membership can pass product-code allowlist", () => {
  const cases = [
    ["Transformation Bronze", PAYPAL_PAY_IN_3_PRODUCT_CODES.transformationBronze],
    ["Transformation Silver", PAYPAL_PAY_IN_3_PRODUCT_CODES.transformationSilver],
    ["Transformation Gold", PAYPAL_PAY_IN_3_PRODUCT_CODES.transformationGold],
    ["Yearly Membership", PAYPAL_PAY_IN_3_PRODUCT_CODES.yearlyMembership],
  ] as const;
  for (const [name, code] of cases) {
    const result = evaluatePayPalPayIn3Eligibility({ product: product(name), productCode: code, readiness: validReadiness });
    assert.equal(result.eligible, true, name);
  }
  for (const name of ["Gym Day Pass", "Week Pass", "Standard Monthly", "Single PT Session"]) {
    const result = evaluatePayPalPayIn3Eligibility({ product: product(name), productCode: null, readiness: validReadiness });
    assert.equal(result.eligible, false, name);
  }
  assert.equal(evaluatePayPalPayIn3Eligibility({ product: product("Transformation Bronze"), productCode: "Transformation Bronze", readiness: validReadiness }).eligible, false);
});

test("feature is disabled by default and fails closed without complete merchant/provider readiness", () => {
  assert.equal(paypalPayIn3FeatureEnabled(undefined), false);
  assert.equal(paypalPayIn3FeatureEnabled("TRUE"), false);
  assert.equal(paypalPayIn3FeatureEnabled("true"), true);
  assert.deepEqual(paypalPayIn3EnvironmentReadiness({} as NodeJS.ProcessEnv), { featureEnabled: false, clientIdConfigured: false, secretConfigured: false });
  const bronze = product("Transformation Bronze");
  for (const readiness of [
    { ...validReadiness, featureEnabled: false },
    { ...validReadiness, secretConfigured: false },
    { ...validReadiness, merchant: { ...validReadiness.merchant, merchantAccountId: null } },
    { ...validReadiness, merchant: { ...validReadiness.merchant, legalEntityNumber: "17383213" } },
    { ...validReadiness, merchant: { ...validReadiness.merchant, paypalApproved: false } },
    { ...validReadiness, merchant: { ...validReadiness.merchant, accountantApproved: false } },
    { ...validReadiness, buyerEligible: false },
  ]) assert.equal(evaluatePayPalPayIn3Eligibility({ product: bronze, productCode: PAYPAL_PAY_IN_3_PRODUCT_CODES.transformationBronze, readiness }).eligible, false);
});

test("Golden Ticket stays lifetime/non-public and requires individual staff-authorised customer sale", () => {
  const golden = product("Golden Ticket Founding Membership");
  assert.equal(golden.isLifetime, true);
  assert.equal(golden.durationDays, undefined);
  assert.equal(golden.sellable, false);
  const base = { product: golden, productCode: PAYPAL_PAY_IN_3_PRODUCT_CODES.goldenTicketLifetime, readiness: validReadiness };
  assert.equal(evaluatePayPalPayIn3Eligibility(base).eligible, false);
  assert.equal(evaluatePayPalPayIn3Eligibility({ ...base, goldenTicketSale: { individuallyAuthorised: false, customerInOrganisation: true } }).eligible, false);
  assert.equal(evaluatePayPalPayIn3Eligibility({ ...base, goldenTicketSale: { individuallyAuthorised: true, customerInOrganisation: false } }).eligible, false);
  const allowed = evaluatePayPalPayIn3Eligibility({ ...base, goldenTicketSale: { individuallyAuthorised: true, customerInOrganisation: true } });
  assert.deepEqual(allowed, { eligible: true, productCode: PAYPAL_PAY_IN_3_PRODUCT_CODES.goldenTicketLifetime, receivingEntity: "Madhouse Franchise Limited" });
});

test("eligibility rejects drift in the existing package entitlement model", () => {
  const bronze = product("Transformation Bronze");
  const changed = { ...bronze, entitlements: bronze.entitlements?.map(item => item.entitlementKey === "pt_session_credit" ? { ...item, allowance: { quantity: 9, period: "week" as const } } : item) };
  assert.equal(evaluatePayPalPayIn3Eligibility({ product: changed, productCode: PAYPAL_PAY_IN_3_PRODUCT_CODES.transformationBronze, readiness: validReadiness }).eligible, false);
  const yearly = product("Yearly Membership");
  assert.equal(evaluatePayPalPayIn3Eligibility({ product: { ...yearly, isLifetime: true }, productCode: PAYPAL_PAY_IN_3_PRODUCT_CODES.yearlyMembership, readiness: validReadiness }).eligible, false);
});

test("merchant always routes to Franchise and schema/action retain fail-closed non-payment boundaries", () => {
  assert.match(migration, /legal_entity_number text not null check \(legal_entity_number = '17383077'\)/);
  assert.match(migration, /enabled boolean not null default false/);
  assert.match(migration, /canonical_product_code text not null check/);
  assert.match(migration, /unique \(organisation_id,idempotency_key\)/);
  assert.match(migration, /unique \(provider_order_id\)/);
  assert.match(migration, /unique \(provider_capture_id\)/);
  assert.match(migration, /unique \(organisation_id,idempotency_key\)/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /from public,anon,authenticated/);
  assert.match(action, /memberships\.assign/);
  assert.match(action, /buyerEligible: false/);
  assert.doesNotMatch(action, /\.insert\(|\.update\(|fetch\s*\(/);
  assert.doesNotMatch(action, /createPayPal|capturePayPal|club_assign_product/);
  const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
  assert.ok(manifest.indexOf("2027-01-02-golden-ticket-lifetime-memberships.sql") < manifest.indexOf("2027-01-03-paypal-pay-in-3-checkout-foundation.sql"));
  const runner = readFileSync("scripts/apply-madhouse-schema.sh", "utf8");
  assert.match(runner, /2027-01-03-paypal-pay-in-3-checkout-foundation\.sql/);
});
