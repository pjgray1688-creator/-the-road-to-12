import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync("supabase/migrations/2027-02-16-madhouse-golden-ticket-duplicate-retirement.sql", "utf8");

test("Golden Ticket correction is limited to the verified imported duplicate and preserves the original", () => {
  assert.match(sql, /v_keep constant uuid := '3ca14913-2689-4f15-a11d-49b934f71480'/);
  assert.match(sql, /v_duplicate constant uuid := '9f699641-e6dd-4976-8bb3-51dec6cc4504'/);
  assert.match(sql, /v_org constant uuid := 'fa44592a-1593-4ad3-a621-63a4a4bcbceb'/);
  assert.match(sql, /v_user constant uuid := 'db8c0932-ec65-40c7-b054-05b820078e5c'/);
  assert.match(sql, /v_batch constant uuid := '6bf9d303-525a-4565-88a4-b4121fac7f98'/);
  assert.match(sql, /source='staff_assignment' and m\.status='active' and m\.ends_at is null/);
  assert.match(sql, /v_duplicate_row\.source<>'legacy_import'[\s\S]*?v_duplicate_row\.import_batch_id<>v_batch/);
  assert.match(sql, /or v_duplicate_row\.ends_at is not null/);
  assert.match(sql, /set status='cancelled',[\s\S]*?where id=v_duplicate and organisation_id=v_org and product_id=v_product and status='active'/);
  assert.doesNotMatch(sql, /set status='cancelled',\s*ends_at=/);
  assert.match(sql, /m\.status='cancelled' and m\.ends_at is null and m\.ended_at is not null/);
  assert.match(sql, /retained_membership_id',v_keep/);
  assert.match(sql, /club_golden_ticket_duplicate_retirements/);
});

test("correction preserves import, entitlement, access, credential, payment and attendance records", () => {
  assert.match(sql, /migration_metadata=coalesce\(migration_metadata,'\{\}'::jsonb\)\|\|jsonb_build_object/);
  assert.match(sql, /original_ends_at',v_duplicate_row\.ends_at/);
  assert.match(sql, /entitlement grant records changed unexpectedly/);
  assert.match(sql, /Existing PIN\/QR credentials changed unexpectedly/);
  assert.match(sql, /Historical access or attendance records changed unexpectedly/);
  assert.match(sql, /Financial or household dependencies were found on the duplicate/);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.(club_memberships|club_membership_holders|club_entitlement_grants|club_access_credentials|club_member_import_rows|club_access_decisions|club_attendance_visits|club_membership_billing)/i);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.(club_memberships|club_entitlement_grants|club_access_credentials|club_membership_billing)/i);
});

test("correction is transactional and safely idempotent", () => {
  assert.match(sql, /\nbegin;/i);
  assert.match(sql, /migration_key=v_key for update/);
  assert.match(sql, /Existing retirement audit does not match/);
  assert.match(sql, /Postflight did not leave exactly one active Golden Ticket membership/);
  assert.match(sql, /commit;\s*$/i);
});
