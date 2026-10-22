import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectStripeLiveTestApproval, stripeLiveTestApprovalMessage, stripeMerchantApiKeyFingerprint, type StripeLiveTestApproval, type StripeMerchantEntity } from "../lib/stripe-merchant";
import { STRIPE_LIVE_TEST_AMOUNT_MINOR, stripeLiveTestMerchants, validateStripeLiveTestEvent } from "../lib/stripe-live-test";

const migration = readFileSync("supabase/migrations/2027-01-18-controlled-stripe-live-tests.sql", "utf8");
const actions = readFileSync("app/club/launch-readiness/stripe/live-test-actions.ts", "utf8");
const page = readFileSync("app/club/launch-readiness/stripe/live-test/page.tsx", "utf8");
const franchiseWebhook = readFileSync("app/api/webhooks/stripe/route.ts", "utf8");
const productsWebhook = readFileSync("app/api/webhooks/stripe/products-services/route.ts", "utf8");
const classWebhook = readFileSync("app/api/webhooks/stripe/classes/route.ts", "utf8");
const migrationManifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
const adminMigration = readFileSync("supabase/migrations/2027-01-19-controlled-stripe-live-test-admins.sql", "utf8");

const keyPair = generateKeyPairSync("ed25519");
const publicKey = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();

function approvalEnv(entity: StripeMerchantEntity, overrides: Partial<StripeLiveTestApproval> = {}) {
  const franchise = entity === "madhouse_franchise";
  const prefix = franchise ? "STRIPE_FRANCHISE" : "STRIPE_PRODUCTS_SERVICES";
  const secret = `rk_live_${franchise ? "Franchise" : "Products"}Fixture123`;
  const approval: StripeLiveTestApproval = {
    version: 1,
    purpose: "r12_controlled_live_payment_test",
    entity,
    accountId: franchise ? "acct_franchise" : "acct_products",
    observedDashboardName: franchise ? "Madhouse Gym Rotherham" : "Madhouse Gym Carlton",
    observedAccountHolder: "Keenan Freer",
    legalEntityTransition: "pending",
    legalEntityVerified: false,
    apiKeyFingerprint: stripeMerchantApiKeyFingerprint(secret),
    amountMinor: 100,
    currency: "GBP",
    approvedAt: "2026-10-22T12:00:00.000Z",
    approvedBy: "Madhouse owner",
    evidenceReference: `dashboard-review-${franchise ? "franchise" : "products"}-2026-10-22`,
    ...overrides,
  };
  const signature = sign(null, Buffer.from(stripeLiveTestApprovalMessage(approval)), keyPair.privateKey).toString("base64");
  return {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    STRIPE_ACCOUNT_BINDING_PUBLIC_KEY: publicKey,
    [`${prefix}_SECRET_KEY`]: secret,
    [`${prefix}_ACCOUNT_ID`]: approval.accountId,
    [franchise ? "STRIPE_FRANCHISE_LIVE_TEST_APPROVAL" : "STRIPE_PRODUCTS_SERVICES_LIVE_TEST_APPROVAL"]: JSON.stringify(approval),
    [franchise ? "STRIPE_FRANCHISE_LIVE_TEST_APPROVAL_SIGNATURE" : "STRIPE_PRODUCTS_SERVICES_LIVE_TEST_APPROVAL_SIGNATURE"]: signature,
  } as NodeJS.ProcessEnv;
}

test("test-only merchant approvals bind account, current Dashboard label, key fingerprint and pending legal transition", () => {
  for (const entity of ["madhouse_franchise", "madhouse_products_services"] as const) {
    const env = approvalEnv(entity);
    assert.equal(inspectStripeLiveTestApproval(entity, env).status, "verified");
    const prefix = entity === "madhouse_franchise" ? "STRIPE_FRANCHISE" : "STRIPE_PRODUCTS_SERVICES";
    const recordKey = `${prefix}_LIVE_TEST_APPROVAL`;
    const approval = JSON.parse(env[recordKey]!) as StripeLiveTestApproval;
    assert.equal(inspectStripeLiveTestApproval(entity, { ...env, [recordKey]: JSON.stringify({ ...approval, legalEntityVerified: true }) } as NodeJS.ProcessEnv).status, "invalid");
    assert.equal(inspectStripeLiveTestApproval(entity, { ...env, [`${prefix}_ACCOUNT_ID`]: "acct_wrong" } as NodeJS.ProcessEnv).status, "mismatch");
    assert.equal(inspectStripeLiveTestApproval(entity, { ...env, [`${prefix}_SECRET_KEY`]: "rk_live_ChangedKey123" } as NodeJS.ProcessEnv).status, "mismatch");
  }
  assert.equal(inspectStripeLiveTestApproval("madhouse_franchise", {} as NodeJS.ProcessEnv).status, "missing");
});

test("amount and destination labels are fixed server values for only the two approved merchants", () => {
  assert.equal(STRIPE_LIVE_TEST_AMOUNT_MINOR, 100);
  assert.equal(stripeLiveTestMerchants.madhouse_franchise.dashboardName, "Madhouse Gym Rotherham");
  assert.equal(stripeLiveTestMerchants.madhouse_products_services.dashboardName, "Madhouse Gym Carlton");
  assert.equal(stripeLiveTestMerchants.madhouse_franchise.title, "Madhouse Franchise");
  assert.equal(stripeLiveTestMerchants.madhouse_products_services.title, "Madhouse Products & Services");
  assert.match(actions, /startFranchiseStripeLiveTestAction\(\)/);
  assert.match(actions, /startProductsServicesStripeLiveTestAction\(\)/);
  assert.doesNotMatch(actions, /p_amount|amountMinor:.*input|merchantOverride|FormData\.get\("(amount|account|merchant)/);
  assert.match(actions, /mode: "payment"/);
  assert.match(actions, /"payment_method_types\[0\]": "card"/);
  assert.match(actions, /Idempotency-Key/);
  assert.match(actions, /\[price_data\]\[unit_amount\]": String\(STRIPE_LIVE_TEST_AMOUNT_MINOR\)/);
  assert.match(actions, /subscription \|\| session\.customer/);
  assert.match(page, /Authorised admin: create £1 \{merchant\.title\} hosted Checkout/);
  assert.match(page, /hasPlayReviewerEntitlement/);
  assert.match(page, /\["owner", "gym_admin"\]\.includes\(context\.role\)/);
  assert.match(actions, /\["owner", "gym_admin"\]\.includes\(context\.role\)/);
  assert.match(actions, /LIVE_ENABLED === "true"/);
});

test("signed webhook validation rejects merchant, amount, mode and reference mismatches", () => {
  const valid = {
    entity: "madhouse_products_services" as const,
    accountId: "acct_products",
    eventId: "evt_live123",
    eventType: "checkout.session.completed",
    eventCreated: 1_792_670_400,
    runId: "8b2329f5-2e4b-49ec-89da-e3df1bbf1741",
    sessionId: "cs_live_session123",
    paymentIntentId: "pi_live123",
    amountMinor: 100,
    currency: "gbp",
    mode: "payment",
    livemode: true,
    checkoutStatus: "complete",
    paymentStatus: "paid",
  };
  assert.equal(validateStripeLiveTestEvent(valid, "madhouse_products_services", "acct_products"), "valid");
  assert.equal(validateStripeLiveTestEvent({ ...valid, entity: "madhouse_franchise" }, "madhouse_products_services", "acct_products"), "merchant_mismatch");
  assert.equal(validateStripeLiveTestEvent({ ...valid, amountMinor: 1000 }, "madhouse_products_services", "acct_products"), "payment_details_mismatch");
  assert.equal(validateStripeLiveTestEvent({ ...valid, livemode: false }, "madhouse_products_services", "acct_products"), "payment_details_mismatch");
  assert.equal(validateStripeLiveTestEvent({ ...valid, paymentIntentId: null }, "madhouse_products_services", "acct_products"), "payment_reference_missing");
  assert.equal(validateStripeLiveTestEvent({ ...valid, sessionId: null, eventType: "payment_intent.payment_failed", paymentStatus: "requires_payment_method" }, "madhouse_products_services", "acct_products"), "valid");
});

test("migration enforces two fixed merchant slots, one £1 attempt each and idempotent webhook reconciliation", () => {
  assert.match(migration, /begin;[\s\S]*commit;/i);
  assert.match(migration, /unique \(merchant_entity\)/i);
  assert.match(migration, /observed_account_holder text not null/i);
  assert.match(migration, /signed_approval jsonb not null/i);
  assert.match(migration, /legal_entity_verified boolean not null default false/i);
  assert.match(migration, /madhouse_only check/i);
  assert.match(migration, /check \(amount_minor=100\)/i);
  assert.match(migration, /check \(currency='GBP'\)/i);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /already reserved; no additional Checkout/);
  assert.match(migration, /on conflict \(provider_event_id\) do nothing/i);
  assert.match(migration, /to service_role/i);
  assert.match(migration, /role='owner'/i);
  assert.match(adminMigration, /member\.role in \('owner','gym_admin'\)/i);
  assert.match(adminMigration, /club_has_active_role\([^;]*array\['owner','gym_admin'\]/i);
  assert.match(adminMigration, /observed_account_holder is distinct from 'Keenan Freer'/i);
  assert.match(adminMigration, /revoke all on function public\.club_begin_stripe_live_test[\s\S]*to service_role/i);
  assert.match(migration, /payment_intent\.payment_failed/);
  assert.doesNotMatch(migration, /insert into public\.(club_orders|club_memberships|club_entitlement_grants|club_class_bookings)/i);
});

test("webhooks reconcile the controlled test before normal fulfilment and keep class events isolated", () => {
  assert.ok(franchiseWebhook.indexOf("reconcileControlledStripeLiveTestWebhook") < franchiseWebhook.indexOf("stripeMembershipEvent(event)"));
  assert.ok(productsWebhook.indexOf("reconcileControlledStripeLiveTestWebhook") < productsWebhook.indexOf("club_record_stripe_commerce_event"));
  assert.match(classWebhook, /controlled_live_test === "1"[\s\S]*status: 204/);
  assert.match(migration, /provider_event_id text primary key/);
  assert.match(migration, /enable row level security/i);
  assert.ok(migrationManifest.indexOf("2027-01-17-member-training-setup-and-coach-plan-read.sql") < migrationManifest.indexOf("2027-01-18-controlled-stripe-live-tests.sql"));
  assert.ok(migrationManifest.indexOf("2027-01-18-controlled-stripe-live-tests.sql") < migrationManifest.indexOf("2027-01-19-controlled-stripe-live-test-admins.sql"));
});

test("only active Madhouse owner or gym admin roles can initiate/read results; ordinary staff and reviewers stay excluded", () => {
  assert.match(actions, /resolveClubOrganisationContext\(client, user\.id, MADHOUSE_ORGANISATION_ID\)/);
  assert.match(actions, /context\.organisation\.id !== MADHOUSE_ORGANISATION_ID/);
  assert.match(actions, /hasPlayReviewerEntitlement\(user\)/);
  assert.match(adminMigration, /member\.active and member\.role in \('owner','gym_admin'\)/i);
  assert.match(adminMigration, /club_has_active_role\([^;]*array\['owner','gym_admin'\]/i);
  assert.doesNotMatch(adminMigration, /role in \([^)]*gym_staff|role in \([^)]*trainer/i);
});
