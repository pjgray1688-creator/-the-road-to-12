import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { madhouseCatalogue, materialiseCatalogueProduct } from "../lib/madhouse-catalogue";
import { evaluatePayPalPayIn3CheckoutReadiness, PAYPAL_PAY_IN_3_PRODUCT_CODES, paypalPayIn3EnvironmentReadiness, paypalPayIn3FeatureEnabled } from "../lib/paypal-pay-in-3";

const migration = readFileSync("supabase/migrations/2027-01-03-paypal-pay-in-3-checkout-foundation.sql", "utf8");
const checkoutMigration = readFileSync("supabase/migrations/2027-01-13-paypal-pay-in-3-checkout.sql", "utf8");
const action = readFileSync("app/club/join/paypal-actions.ts", "utf8");
const validReadiness = {
  featureEnabled: true, clientIdConfigured: true, secretConfigured: true,
  merchant: { legalEntityNumber: "17383077", merchantAccountId: "merchant-franchise", paypalApproved: true, accountantApproved: true, enabled: true },
};
const product = (name: string) => {
  const definition = madhouseCatalogue.find(item => item.name === name);
  assert.ok(definition);
  return materialiseCatalogueProduct(definition, "madhouse");
};

test("only Franchise membership products can pass the PayPal product-code allowlist", () => {
  const cases = [["Yearly Membership", PAYPAL_PAY_IN_3_PRODUCT_CODES.yearlyMembership]] as const;
  for (const [name, code] of cases) {
    const result = evaluatePayPalPayIn3CheckoutReadiness({ product: product(name), productCode: code, readiness: validReadiness });
    assert.equal(result.checkoutReady, true, name);
    if (result.checkoutReady) assert.equal(result.financingDecision, "paypal_decides_at_checkout");
  }
  for (const name of ["Day Pass", "1 Week Pass", "Unlimited Gym", "Single PT Session"]) {
    const result = evaluatePayPalPayIn3CheckoutReadiness({ product: product(name), productCode: null, readiness: validReadiness });
    assert.equal(result.checkoutReady, false, name);
  }
  assert.equal(evaluatePayPalPayIn3CheckoutReadiness({ product: product("Transformation Bronze"), productCode: "Transformation Bronze", readiness: validReadiness }).checkoutReady, false);
  assert.equal(evaluatePayPalPayIn3CheckoutReadiness({ product: product("Transformation Bronze"), productCode: PAYPAL_PAY_IN_3_PRODUCT_CODES.transformationBronze, readiness: validReadiness }).checkoutReady, false);
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
  ]) assert.equal(evaluatePayPalPayIn3CheckoutReadiness({ product: bronze, productCode: PAYPAL_PAY_IN_3_PRODUCT_CODES.transformationBronze, readiness }).checkoutReady, false);
  assert.equal(evaluatePayPalPayIn3CheckoutReadiness({
    product: bronze, productCode: PAYPAL_PAY_IN_3_PRODUCT_CODES.transformationBronze,
    readiness: { ...validReadiness, buyerEligible: false },
  } as never).checkoutReady, false, "Products & Services packages cannot use the Franchise PayPal merchant");
});

test("Golden Ticket stays lifetime/non-public and requires individual staff-authorised customer sale", () => {
  const golden = product("Golden Ticket Founding Membership");
  assert.equal(golden.isLifetime, true);
  assert.equal(golden.durationDays, undefined);
  assert.equal(golden.sellable, false);
  const base = { product: golden, productCode: PAYPAL_PAY_IN_3_PRODUCT_CODES.goldenTicketLifetime, readiness: validReadiness };
  assert.equal(evaluatePayPalPayIn3CheckoutReadiness(base).checkoutReady, false);
  assert.equal(evaluatePayPalPayIn3CheckoutReadiness({ ...base, goldenTicketSale: { individuallyAuthorised: false, customerInOrganisation: true } }).checkoutReady, false);
  assert.equal(evaluatePayPalPayIn3CheckoutReadiness({ ...base, goldenTicketSale: { individuallyAuthorised: true, customerInOrganisation: false } }).checkoutReady, false);
  const allowed = evaluatePayPalPayIn3CheckoutReadiness({ ...base, goldenTicketSale: { individuallyAuthorised: true, customerInOrganisation: true } });
  assert.deepEqual(allowed, { checkoutReady: true, productCode: PAYPAL_PAY_IN_3_PRODUCT_CODES.goldenTicketLifetime, receivingEntity: "Madhouse Franchise Limited", financingDecision: "paypal_decides_at_checkout" });
});

test("eligibility rejects drift in the existing package entitlement model", () => {
  const bronze = product("Transformation Bronze");
  const changed = { ...bronze, entitlements: bronze.entitlements?.map(item => item.entitlementKey === "pt_session_credit" ? { ...item, allowance: { quantity: 9, period: "week" as const } } : item) };
  assert.equal(evaluatePayPalPayIn3CheckoutReadiness({ product: changed, productCode: PAYPAL_PAY_IN_3_PRODUCT_CODES.transformationBronze, readiness: validReadiness }).checkoutReady, false);
  const missingIncludedClass = { ...bronze, entitlements: bronze.entitlements?.filter(item => item.entitlementKey !== "included_class_credit") };
  assert.equal(evaluatePayPalPayIn3CheckoutReadiness({ product: missingIncludedClass, productCode: PAYPAL_PAY_IN_3_PRODUCT_CODES.transformationBronze, readiness: validReadiness }).checkoutReady, false);
  const yearly = product("Yearly Membership");
  assert.equal(evaluatePayPalPayIn3CheckoutReadiness({ product: { ...yearly, isLifetime: true }, productCode: PAYPAL_PAY_IN_3_PRODUCT_CODES.yearlyMembership, readiness: validReadiness }).checkoutReady, false);
});

test("merchant always routes to Franchise and the operational checkout stays gated", () => {
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
  assert.match(action, /financingDecision: result\.financingDecision/);
  assert.match(action, /createPayPalOrder/);
  assert.match(action, /club_prepare_paypal_pay_in_3_order/);
  assert.match(action, /club_store_paypal_pay_in_3_order/);
  assert.match(checkoutMigration, /create unique index if not exists club_paypal_one_open_order_per_join_uq/);
  assert.match(checkoutMigration, /jsonb_to_recordset\(o\.entitlement_snapshot\)/);
  assert.match(checkoutMigration, /for update/);
  assert.match(migration, /unique \(provider_capture_id\)/);
  assert.match(checkoutMigration, /grant execute on function public\.club_reconcile_paypal_pay_in_3_event[\s\S]*to service_role/);
  assert.match(readFileSync("app/api/webhooks/paypal/pay-in-3/route.ts", "utf8"), /verifyPayPalWebhook/);
  assert.match(readFileSync("lib/paypal-provider.ts", "utf8"), /verify-webhook-signature/);
  const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
  assert.ok(manifest.indexOf("2027-01-03-paypal-pay-in-3-checkout-foundation.sql") < manifest.indexOf("2027-01-13-paypal-pay-in-3-checkout.sql"));
  const runner = readFileSync("scripts/apply-madhouse-schema.sh", "utf8");
  assert.match(runner, /2027-01-13-paypal-pay-in-3-checkout\.sql/);
});
