import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2027-02-15-madhouse-member-activation-import-row-deduplication.sql", "utf8");
const helperStart = migration.indexOf("create or replace function public.club_imported_member_email_is_ambiguous");
const helperEnd = migration.indexOf("revoke all on function public.club_imported_member_email_is_ambiguous", helperStart);
const helper = migration.slice(helperStart, helperEnd);
const previewStart = migration.indexOf("create or replace function public.club_preview_madhouse_member_activation_invitations");
const previewEnd = migration.indexOf("revoke all on function public.club_preview_madhouse_member_activation_invitations", previewStart);
const preview = migration.slice(previewStart, previewEnd);

test("repeated import rows are safe only when one exact legacy identity maps to the candidate customer", () => {
  assert.notEqual(helperStart, -1);
  assert.match(helper, /v_reference_count<>1 or v_missing_reference_count<>0/);
  assert.match(helper, /v_unmapped_count<>0[\s\S]*v_identity_customer_count<>1/);
  assert.match(helper, /i\.customer_id=p_customer_id/);
  assert.match(helper, /v_name_count>1 or v_home_count>1 or v_phone_count>1/);
  assert.match(helper, /v_name_mismatch/);
  assert.match(helper, /count\(\*\) from public\.club_customers c[\s\S]*\)<>1 then/);
});

test("preview uses the same repeat-row identity gates without restoring row-by-row classification", () => {
  assert.notEqual(previewStart, -1);
  assert.match(preview, /reference_count=1 and ic\.missing_reference_count=0 and ic\.unmapped_count=0/);
  assert.match(preview, /ic\.identity_customer_count=1 and c\.id=any\(ic\.identity_customer_ids\)/);
  assert.match(preview, /ic\.source_name_count<=1 and ic\.source_home_count<=1 and ic\.source_phone_count<=1/);
  assert.match(preview, /ic\.name_mismatch_count=0/);
  assert.doesNotMatch(preview, /club_madhouse_member_activation_candidate_state\s*\(/);
  assert.match(preview, /shared_contract_customers as materialized/);
});

test("real customer, household, account and membership conflicts remain fail-closed", () => {
  assert.match(helper, /lower\(btrim\(coalesce\(c\.email,''\)\)\)=lower\(btrim\(p_email\)\)/);
  assert.match(helper, /club_membership_shared_contracts/);
  assert.match(helper, /householdReference/);
  assert.match(preview, /coalesce\(cc\.row_count,0\)>1/);
  assert.match(preview, /household_customers hc on hc\.customer_id=c\.id/);
  assert.match(preview, /shared_contract_customers sc on sc\.customer_id=c\.id/);
  assert.match(preview, /auth_email_conflicts/);
  assert.match(preview, /m\.status='active'.*m\.starts_at<=now\(\).*m\.ends_at is null or m\.ends_at>now\(\)/s);
  assert.match(migration, /p_organisation_id<>'fa44592a-1593-4ad3-a621-63a4a4bcbceb'/);
  assert.match(migration, /members\.link_account/);
  assert.match(migration, /m\.active and m\.role in \('owner','gym_admin'\)/);
});

test("forward migration preserves exact-email ownership flow and set-based preview grants", () => {
  const claimMigration = readFileSync("supabase/migrations/2027-02-12-madhouse-member-self-service-activation-invitations.sql", "utf8");
  assert.match(claimMigration, /email_confirmed_at/);
  assert.match(claimMigration, /club_imported_member_email_is_ambiguous/);
  assert.match(migration, /revoke all on function public\.club_imported_member_email_is_ambiguous\(uuid,uuid,text\) from public,anon,authenticated/);
  assert.match(migration, /revoke all on function public\.club_preview_madhouse_member_activation_invitations\(uuid\) from public,anon/);
  assert.match(migration, /grant execute on function public\.club_preview_madhouse_member_activation_invitations\(uuid\) to authenticated/);
  assert.match(migration, /begin;[\s\S]*commit;/);
});
