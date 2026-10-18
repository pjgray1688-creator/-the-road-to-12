import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-12-30-member-account-readiness-and-cash-evidence.sql", "utf8");
const importAndClaim = readFileSync("supabase/migrations/2026-11-18-member-acquisition-onboarding.sql", "utf8");
const importQueue = readFileSync("supabase/migrations/2026-12-24-staff-owner-transfer-and-member-activation-queue.sql", "utf8");
const household = readFileSync("supabase/migrations/2026-12-13-member-age-induction-access-eligibility.sql", "utf8");
const billing = readFileSync("supabase/migrations/2026-09-28-club-membership-billing-dunning.sql", "utf8");

test("email-only identity never merges duplicated/shared member profiles", () => {
  assert.match(importAndClaim, /if v_count>1 then return jsonb_build_object\('state','ambiguous'/);
  assert.match(importAndClaim, /R12 account is already linked to another member/);
  assert.match(importAndClaim, /p_verification_method not in \('photo_id','membership_reference','in_person'\)/);
  assert.match(migration, /This email is shared by another member record/);
  assert.match(migration, /staff_assisted_activation_required/);
});

test("unique-email self-service is distinct from email-only identity and shared emails remain staff-assisted", () => {
  assert.match(migration, /club_member_activation_email_verifications/);
  assert.match(migration, /members\.link_account/);
  assert.match(migration, /email_normalized=lower\(btrim\(coalesce\(c\.email,''\)\)\)/);
  assert.match(migration, /select count\(\*\) from public\.club_customers same_email/);
  assert.match(migration, /new\.target_email:=null;\s*new\.state:='unavailable'/);
  assert.match(migration, /where n\.template_key='member_activation' and n\.state<>'sent'/);
  assert.match(migration, /A unique personal email or staff-verified personal email is required before activation/);
  assert.match(importAndClaim, /v_verified is null/);
  assert.match(importAndClaim, /if v_count<>1 then raise exception 'Member record is missing or ambiguous'/);
  assert.match(importAndClaim, /R12 account is already linked to another member/);
  assert.match(importQueue, /alreadyLinked/);
});

test("readiness report distinguishes login blockers and shared payer/relationship review without exporting email", () => {
  const start = migration.indexOf("create or replace function public.club_get_member_activation_readiness");
  const end = migration.indexOf("revoke all on function public.club_get_member_activation_readiness", start);
  const report = migration.slice(start, end);
  assert.match(report, /shared_email_requires_individual_confirmation/);
  assert.match(report, /personal_email_requires_confirmation/);
  assert.match(report, /payerConfirmationRequired/);
  assert.match(report, /payerRecordMissing/);
  assert.doesNotMatch(report, /'email',c\.email|emailAddress/);
  const component = readFileSync("components/club-member-activation-readiness.tsx", "utf8");
  assert.match(component, /download = "member-account-readiness\.csv"/);
  assert.match(component, /No email addresses are included/);
});

test("one household membership retains one billing arrangement and projects group-wide payment state", () => {
  assert.match(billing, /unique \(organisation_id, membership_id\)/);
  assert.match(billing, /unique \(arrangement_id, period_key\)/);
  assert.match(household, /club_membership_holders/);
  assert.match(migration, /club_membership_payment_access_suspensions set active=false/);
  assert.match(migration, /candidate\.id is null or not exists\(select 1 from public\.club_membership_payment_access_suspensions/);
  assert.match(readFileSync("supabase/migrations/2026-12-04-member-pin-qr-access-pass.sql", "utf8"), /create trigger club_suspension_access_projection_refresh/);
});

test("a parent/partner payer is represented separately and may cover multiple member profiles", () => {
  assert.match(migration, /payer must have a linked organisation customer profile/i);
  assert.match(migration, /where id=p_customer_id and organisation_id=p_organisation_id and user_id=p_user_id/);
  assert.match(migration, /cm\.user_id=p_user_id and cm\.active/);
  assert.match(migration, /on conflict\(organisation_id,membership_id\) do update/);
  assert.match(migration, /create or replace function public\.club_enrol_membership_billing/);
  assert.match(migration, /a\.customer_id/);
  assert.match(migration, /payerConfirmationRequired/);
  assert.match(migration, /sharedMembershipReviewRequired/);
  assert.doesNotMatch(migration, /insert into public\.club_membership_holders/);
});

test("cash is staff-verified with amount, dates, idempotency and actor audit; member declarations do not settle", () => {
  assert.match(migration, /receipt_date date/);
  assert.match(migration, /paid_through_date date/);
  assert.match(migration, /recorded_by uuid references auth\.users/);
  assert.match(migration, /club_record_verified_membership_cash_payment/);
  assert.match(migration, /payments\.record_cash/);
  assert.match(migration, /membership\.cash_payment_verified/);
  assert.match(migration, /This cash receipt was already recorded with different evidence/);
  assert.match(migration, /'coverageNeedsReview',member_status<>'active'/);
  assert.doesNotMatch(migration.slice(migration.indexOf("create or replace function public.club_record_verified_membership_cash_payment"), migration.indexOf("revoke all on function public.club_record_verified_membership_cash_payment")), /update public\.club_memberships/);
  const cashComponent = readFileSync("components/club-membership-cash-payment.tsx", "utf8");
  assert.match(cashComponent, /Amount received/);
  assert.match(cashComponent, /membership is expired or inactive; review membership coverage separately before confirming access/i);
});

test("home location remains separate from organisation-wide entitlement/access checks", () => {
  const locationImport = readFileSync("supabase/migrations/2026-12-22-member-import-home-location.sql", "utf8");
  const access = readFileSync("supabase/migrations/2026-09-10-club-membership-access.sql", "utf8");
  assert.match(locationImport, /preferred_location_id/);
  assert.doesNotMatch(locationImport, /access_scope|location_ids|entitlement_grants/i);
  assert.match(access, /club_evaluate_member_access/);
});

test("readiness migration is in the deployment manifest and disposable PostgreSQL chain after its prerequisites", () => {
  const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
  const harness = readFileSync("scripts/validate-coach-nutrition-reconciliation-postgres.sh", "utf8");
  const householdFixture = readFileSync("tests/sql/member-household-billing-lifecycle.sql", "utf8");
  const cashMigration = readFileSync("supabase/migrations/2026-12-31-cash-membership-period-and-anniversary-safety.sql", "utf8");
  assert.match(manifest, /2026-12-30-member-account-readiness-and-cash-evidence\.sql/);
  const prerequisites = [
    "2026-09-28-club-membership-billing-dunning.sql",
    "2026-10-05-club-membership-cash-settlement.sql",
    "2026-12-01-paid-member-provider-checkout.sql",
    "2026-12-02-gocardless-recurring-collections.sql",
    "2026-12-03-member-import-and-access.sql",
    "2026-12-04-member-pin-qr-access-pass.sql",
    "2026-12-12-membership-access-lifecycle.sql",
    "2026-12-13-member-age-induction-access-eligibility.sql",
    "2026-12-30-club-station-password-reauth.sql",
    "2026-12-30-member-account-readiness-and-cash-evidence.sql",
  ].map(file => manifest.indexOf(file));
  assert.ok(prerequisites.every(position => position >= 0), "all required membership, cash, access and readiness migrations must be listed");
  assert.deepEqual(prerequisites, [...prerequisites].sort((a, b) => a - b), "deployment manifest must preserve prerequisite order");
  const harnessPrerequisites = [
    "2026-12-01-paid-member-provider-checkout.sql",
    "2026-12-02-gocardless-recurring-collections.sql",
    "2026-12-03-member-import-and-access.sql",
    "2026-12-04-member-pin-qr-access-pass.sql",
    "2026-12-12-membership-access-lifecycle.sql",
    "2026-12-13-member-age-induction-access-eligibility.sql",
    "2026-12-30-member-account-readiness-and-cash-evidence.sql",
  ].map(file => harness.indexOf(`--file=supabase/migrations/${file}`));
  assert.ok(harnessPrerequisites.every(position => position >= 0), "household fixture prerequisites must be applied in its fresh disposable state");
  assert.deepEqual(harnessPrerequisites, [...harnessPrerequisites].sort((a, b) => a - b), "disposable harness must preserve household migration dependency order");
  assert.ok(harness.indexOf("2026-12-30-club-station-password-reauth.sql") < harness.indexOf("2026-12-30-member-account-readiness-and-cash-evidence.sql"));
  assert.ok(harness.indexOf("2026-12-30-member-account-readiness-and-cash-evidence.sql") < harness.indexOf("tests/sql/member-household-billing-lifecycle.sql"));
  assert.ok(harness.indexOf("tests/sql/member-household-billing-lifecycle.sql") < harness.indexOf("tests/sql/notification-outbox-launch.sql"));
  assert.match(householdFixture, /payment_failed/);
  assert.match(householdFixture, /club_evaluate_membership_billing/);
  assert.match(householdFixture, /household-cash-recovery/);
  assert.match(householdFixture, /club_record_verified_membership_cash_payment/);
  assert.match(householdFixture, /shared-household@example\.test/);
  assert.match(householdFixture, /Member without email/);
  assert.match(householdFixture, /club_access_safety_facts/);
  assert.match(householdFixture, /rollback;/);
  assert.ok(manifest.indexOf("2026-12-30-member-account-readiness-and-cash-evidence.sql") < manifest.indexOf("2026-12-31-cash-membership-period-and-anniversary-safety.sql"));
  assert.ok(harness.indexOf("2026-12-30-member-account-readiness-and-cash-evidence.sql") < harness.indexOf("2026-12-31-cash-membership-period-and-anniversary-safety.sql"));
  assert.ok(harness.indexOf("2026-12-31-cash-membership-period-and-anniversary-safety.sql") < harness.indexOf("tests/sql/member-household-billing-lifecycle.sql"));
  assert.match(cashMigration, /billing_period_start date/);
  assert.match(cashMigration, /billing_period_end date/);
  assert.match(cashMigration, /club_membership_anniversary\(a\.next_due_at/);
  assert.match(cashMigration, /membership_row\.status='active'.*product_billing='recurring'/s);
  assert.match(cashMigration, /Fixed-duration and one-off memberships cannot create monthly billing obligations/);
  assert.doesNotMatch(cashMigration, /update public\.club_memberships\s+set\s+(status|ends_at)/i);
});
