import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clubDirectoryMembershipStatus } from "../lib/club-member-directory";

const correction = readFileSync("supabase/migrations/2027-02-10-madhouse-imported-membership-status-correction.sql", "utf8");
const operations = readFileSync("supabase/migrations/2027-02-09-club-member-profile-membership-cash-operations.sql", "utf8");
const counterLedger = readFileSync("supabase/migrations/2027-01-27-club-counter-membership-payments.sql", "utf8");
const preflight = readFileSync("supabase/verification/2027-02-10-madhouse-membership-status-preflight.sql", "utf8");
const postflight = readFileSync("supabase/verification/2027-02-10-madhouse-membership-status-postflight.sql", "utf8");

test("directory distinguishes recent lapses from former records after two months", () => {
  const now = new Date("2026-11-19T12:00:00.000Z");
  assert.equal(clubDirectoryMembershipStatus("expired", "2026-09-18T23:00:00Z", now), "former");
  assert.equal(clubDirectoryMembershipStatus("expired", "2026-09-19T23:00:00Z", now), "lapsed");
  assert.equal(clubDirectoryMembershipStatus("expired", "2026-11-19T23:00:00Z", now), "lapsed");
  assert.equal(clubDirectoryMembershipStatus("cancelled", "2026-11-19T23:00:00Z", now), "former");
  assert.equal(clubDirectoryMembershipStatus("active", "2025-01-01", now), "active");
});

test("Madhouse correction is scoped, date-aware, and excludes blocked or historical rows", () => {
  assert.match(correction, /fa44592a-1593-4ad3-a621-63a4a4bcbceb/);
  assert.match(correction, /6bf9d303-525a-4565-88a4-b4121fac7f98/);
  assert.match(correction, /v_batch_rows<>702 or v_memberships<>477/);
  assert.match(correction, /p\.is_lifetime or m\.ends_at>now\(\)/);
  assert.match(correction, /p\.legacy_import_category is null/);
  assert.match(correction, /club_membership_payment_access_suspensions/);
  assert.match(correction, /club_membership_shared_contracts/);
  assert.match(correction, /club_membership_billing_obligations/);
  assert.match(correction, /club_membership_billing_arrangements/);
  assert.match(correction, /club_membership_counter_payments/);
  assert.match(correction, /ilike '%fraud%'/);
  assert.match(correction, /get diagnostics v_changed=row_count/);
  assert.match(correction, /club_import_membership_status_corrections/);
  assert.doesNotMatch(correction, /update public\.club_membership_holders/i);
  assert.doesNotMatch(correction, /insert into public\.club_membership_billing_arrangements/i);
  assert.doesNotMatch(correction, /insert into public\.club_membership_billing_obligations/i);
  assert.doesNotMatch(correction, /subscription|mandate|charge/i);
});

test("only linked, verified and active R12 identities receive new membership-bound gym grants", () => {
  const grantInsert = correction.slice(correction.indexOf("insert into public.club_entitlement_grants"));
  assert.match(grantInsert, /join public\.club_members cm[\s\S]*?cm\.active/);
  assert.match(grantInsert, /join auth\.users u[\s\S]*?email_confirmed_at is not null or u\.phone_confirmed_at is not null/);
  assert.match(grantInsert, /e\.entitlement_key='gym_access'/);
  assert.match(grantInsert, /not exists\(select 1 from public\.club_entitlement_grants existing/);
  assert.match(postflight, /active_linked_without_valid_gym_grant/);
  assert.match(postflight, /valid_gym_grant/);
});

test("status preflight reports candidate, lapse, pending and manual-review groups without PII", () => {
  for (const bucket of ["eligible_for_status_correction", "recent_lapse_within_two_months", "former_over_two_months", "pending_review_no_imported_membership", "manual_review_current_term_has_blocker_or_no_gym_entitlement"]) assert.ok(preflight.includes(bucket));
  assert.doesNotMatch(preflight, /select[^;]*(email|phone|display_name)/is);
  assert.match(preflight, /702/);
  assert.match(preflight, /477/);
});

test("profile edits change Club customer contact only and audit fields without changing Auth identity", () => {
  assert.match(operations, /club_get_customer_profile_details[\s\S]*members\.create/);
  assert.match(operations, /club_update_customer_profile_details[\s\S]*members\.create/);
  assert.match(operations, /update public\.club_customers set display_name/);
  assert.match(operations, /auth_identity_changed',false/);
  assert.match(operations, /glow_age_verification_changed',false/);
  assert.doesNotMatch(operations, /update auth\.users/i);
  assert.match(operations, /p_home_location_id.*organisation_id=p_organisation_id/s);
});

test("membership management keeps provider and household payment authority protected", () => {
  assert.match(operations, /club_update_manual_membership[\s\S]*memberships\.manage/);
  assert.match(operations, /club_membership_billing_arrangements a/);
  assert.match(operations, /A billing record controls this membership/);
  assert.match(operations, /club_membership_shared_contracts s[\s\S]*shared payer contract/);
  assert.match(operations, /club_entitlement_usage/);
  assert.match(operations, /A billing record controls this membership/);
  assert.match(operations, /club_get_membership_management_detail[\s\S]*club_membership_billing_payments/);
});

test("cash recording reuses the counter ledger with venue checks, idempotency and no provider bypass", () => {
  assert.match(operations, /club_record_existing_membership_cash_payment/);
  assert.match(operations, /club_location_authorized\(p_organisation_id,p_location_id\)/);
  assert.match(operations, /pg_advisory_xact_lock/);
  assert.match(counterLedger, /unique\(organisation_id,idempotency_key\)/i);
  assert.match(operations, /verified_by,verified_at,verification_note/);
  assert.match(operations, /p_paid_through<>p_period_end/);
  assert.match(operations, /club_membership_billing_arrangements/);
  assert.match(operations, /club_membership_shared_contracts/);
  assert.match(operations, /club_membership_billing_obligations/);
  assert.match(operations, /club_audit_events[\s\S]*membership\.cash_payment_recorded/);
});
