import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runbook = readFileSync("docs/madhouse-schema-deployment.md", "utf8");
const bootstrap = readFileSync("docs/manual-sql/madhouse-first-organisation-bootstrap.sql", "utf8");
const runner = readFileSync("scripts/apply-madhouse-schema.sh", "utf8");
const followUpRelease = readFileSync("supabase/deployment/2026-11-22-r12-launch-follow-up.sql", "utf8");
const stripeSubscriptions = readFileSync("supabase/migrations/2027-01-11-stripe-membership-subscriptions.sql", "utf8");
const stripeMerchantIsolation = readFileSync("supabase/migrations/2027-01-12-two-stripe-merchant-isolation.sql", "utf8");

test("Madhouse runbook gives one controlled deployment and read-only verification path", () => {
  assert.match(runbook, /apply-madhouse-schema\.sh/);
  assert.match(runbook, /r12_schema_migrations/);
  assert.match(runbook, /to_regclass/);
  assert.match(runbook, /club_claim_notification_intents/);
  assert.match(runbook, /Do not run the superseded replay bundle or historical repair migrations manually/);
});

test("first organisation bootstrap requires a verified existing Auth identity", () => {
  assert.match(bootstrap, /email_confirmed_at is not null/);
  assert.match(bootstrap, /REPLACE_WITH_EXISTING_AUTH_USER_UUID/);
  assert.match(bootstrap, /v_grant_coach boolean := false/);
  assert.match(bootstrap, /coach_permissions/);
  assert.match(bootstrap, /on conflict \(organisation_id,user_id\)/i);
  assert.doesNotMatch(bootstrap, /insert into auth\.users/i);
  assert.doesNotMatch(bootstrap, /club_members.*Peter|Keenan|Shan|George|Luke|Amie/is);
});

test("runner cannot silently continue after a migration checksum or SQL failure", () => {
  assert.match(runner, /ON_ERROR_STOP=1/);
  assert.match(runner, /Checksum mismatch/);
  assert.match(runner, /exit 4/);
  assert.match(runner, /psql .* -f/);
});

test("follow-up SQL includes missing 01-02/01-03 prerequisites and accepts all-pending migrations", () => {
  const preflight = followUpRelease.match(/do \$preflight\$([\s\S]*?)end \$preflight\$;/)?.[1];
  assert.ok(preflight, "release preflight exists");
  const loops = [...preflight.matchAll(/for v_name, v_expected in select \* from \(values([\s\S]*?)\) as (required|included)\(migration_name,checksum\) loop([\s\S]*?)end loop;/g)];
  assert.equal(loops.length, 2);
  const names = (index: number) => [...loops[index][1].matchAll(/\('(supabase\/migrations\/[^']+\.sql)'/g)].map(match => match[1]);
  assert.deepEqual(names(0), [
    "supabase/migrations/2027-01-04-madhouse-class-booking-fail-closed.sql",
    "supabase/migrations/2027-01-05-madhouse-weekly-operations-import.sql",
    "supabase/migrations/2027-01-06-madhouse-trusted-station-checkin.sql",
    "supabase/migrations/2027-01-07-madhouse-class-credit-iso-weeks.sql",
    "supabase/migrations/2027-01-08-madhouse-daily-checks-import.sql",
    "supabase/migrations/2027-01-09-madhouse-class-payments-and-register.sql",
  ]);
  assert.deepEqual(names(1), [
    "supabase/migrations/2027-01-02-golden-ticket-lifetime-memberships.sql",
    "supabase/migrations/2027-01-03-paypal-pay-in-3-checkout-foundation.sql",
    "supabase/migrations/2027-01-10-madhouse-pending-staff-assignments.sql",
    "supabase/migrations/2027-01-11-stripe-membership-subscriptions.sql",
    "supabase/migrations/2027-01-12-two-stripe-merchant-isolation.sql",
    "supabase/migrations/2027-01-13-paypal-pay-in-3-checkout.sql",
  ]);
  assert.match(loops[0][3], /if v_actual is distinct from v_expected then raise exception/);
  assert.match(loops[1][3], /if v_actual is not null and v_actual<>v_expected then raise exception/);

  // These assertions mirror the SQL branch: NULL is allowed for each pending
  // migration, but a present checksum must match the source migration.
  const rejectsIncludedChecksum = (actual: string | null, expected: string) => actual !== null && actual !== expected;
  assert.equal(names(1).every(() => !rejectsIncludedChecksum(null, "source-checksum")), true);
  assert.equal(rejectsIncludedChecksum("wrong-checksum", "source-checksum"), true);
  assert.equal(rejectsIncludedChecksum("source-checksum", "source-checksum"), false);

  const migrationOrder = [...followUpRelease.matchAll(/-- BEGIN (2027-01-[^\n]+\.sql)/g)].map(match => match[1]);
  assert.deepEqual(migrationOrder, [
    "2027-01-02-golden-ticket-lifetime-memberships.sql",
    "2027-01-03-paypal-pay-in-3-checkout-foundation.sql",
    "2027-01-10-madhouse-pending-staff-assignments.sql",
    "2027-01-11-stripe-membership-subscriptions.sql",
    "2027-01-12-two-stripe-merchant-isolation.sql",
    "2027-01-13-paypal-pay-in-3-checkout.sql",
  ]);
  assert.match(followUpRelease, /begin;[\s\S]*?commit;/i);
  assert.match(followUpRelease, /on conflict \(migration_name\) do nothing/i);
  for (const alreadyApplied of names(0)) {
    assert.equal(migrationOrder.includes(alreadyApplied.split("/").at(-1)!), false, `${alreadyApplied} must not be replayed`);
  }
});

test("Stripe migrations add all join-request columns before old-schema indexes and functions", () => {
  const requiredColumns = [
    "stripe_checkout_session_id", "stripe_payment_intent_id", "stripe_checkout_generation",
    "stripe_event_occurred_at", "stripe_customer_id", "stripe_subscription_id",
    "stripe_subscription_status", "stripe_subscription_event_at", "stripe_current_period_end",
    "stripe_latest_invoice_id", "stripe_initial_payment_event_at", "stripe_initial_charge_reversed",
    "stripe_charge_refunded", "stripe_dispute_open", "stripe_refund_event_at",
    "stripe_dispute_event_at", "stripe_merchant_entity", "stripe_account_id",
  ];
  const declarations = (sql: string) => new Set(
    [...sql.matchAll(/add column if not exists\s+(stripe_[a-z_]+)/gi)].map(match => match[1].toLowerCase()),
  );
  const olderProductionSchema = new Set<string>();

  // Model the deployed join-request table with none of these optional Stripe
  // columns, then apply each migration's early additive declarations.
  const migration11Declarations = stripeSubscriptions.slice(0, stripeSubscriptions.search(/create unique index/i));
  for (const column of declarations(migration11Declarations)) olderProductionSchema.add(column);
  assert.ok(requiredColumns.filter(column => !olderProductionSchema.has(column)).length > 0,
    "the old-schema fixture should be missing fields added by 01-12");

  const migration12Early = stripeMerchantIsolation.slice(0, stripeMerchantIsolation.search(/alter table public\.club_commerce_products/i));
  for (const column of declarations(migration12Early)) olderProductionSchema.add(column);
  assert.deepEqual(requiredColumns.filter(column => !olderProductionSchema.has(column)), []);

  for (const [name, sql] of [["01-11", stripeSubscriptions], ["01-12", stripeMerchantIsolation]] as const) {
    const firstUse = sql.search(/create (?:unique )?index|create or replace function/i);
    assert.notEqual(firstUse, -1, `${name} has a relevant index/function`);
    const earlyDeclarations = declarations(sql.slice(0, firstUse));
    const expectedEarlyColumns = name === "01-11"
      ? requiredColumns.filter(column => column !== "stripe_merchant_entity" && column !== "stripe_account_id")
      : requiredColumns;
    assert.ok(expectedEarlyColumns.every(column => earlyDeclarations.has(column)), `${name} declares join-request Stripe fields before any index/function`);
  }
  assert.match(stripeMerchantIsolation, /on public\.club_membership_join_requests\(stripe_account_id,stripe_checkout_session_id\)/);
  assert.match(stripeMerchantIsolation, /add column if not exists stripe_checkout_session_id text/i);
});
