import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/2027-02-04-club-member-import-approved-exceptions.sql",
);
const recoveryPath = join(
  process.cwd(),
  "supabase/migrations/2027-02-03-club-member-import-conflict-recovery.sql",
);
const fixedTermPath = join(
  process.cwd(),
  "supabase/migrations/2027-02-02-club-fixed-term-memberships.sql",
);
const actionPath = join(process.cwd(), "app/club/members/import/actions.ts");
const componentPath = join(process.cwd(), "components/club-member-import.tsx");
const sql = readFileSync(migrationPath, "utf8");
const existingRecovery = readFileSync(recoveryPath, "utf8");
const fixedTerm = readFileSync(fixedTermPath, "utf8");
const action = readFileSync(actionPath, "utf8");
const component = readFileSync(componentPath, "utf8");

test("exception recovery replaces the installed RPC signature and keeps prerequisites ordered", () => {
  assert.match(sql, /to_regprocedure\('public\.club_recover_rejected_member_import_batch\(uuid,uuid\)'\)/);
  assert.match(sql, /create or replace function public\.club_recover_rejected_member_import_batch\(p_organisation_id uuid,p_batch_id uuid\)/);
  assert.match(sql, /club_execute_member_import_batch_individual_base\(org,b\.id\)/);
  assert.match(existingRecovery, /create or replace function public\.club_execute_member_import_batch_individual_base/);
  assert.match(fixedTerm, /club_set_fixed_term_membership_boundary/);
});

test("Jake's exact source row receives a non-recurring fixed-term access mapping, never Standard Monthly", () => {
  assert.match(sql, /source_row_number=9/);
  assert.match(sql, /jake pepper/);
  assert.match(sql, /gold package , unlimited gym/);
  assert.match(sql, /2026-09-27/);
  assert.match(sql, /2026-12-09/);
  assert.match(sql, /Legacy Gold Transformation Gym Access/);
  assert.match(sql, /'one_off'.*74,'day'/s);
  assert.match(sql, /'gym_access','future_locations'/);
  assert.match(sql, /2026-12-10'::date::timestamp at time zone 'Europe\/London'/);
  assert.match(sql, /'renewal','none'/);
  assert.doesNotMatch(sql, /Standard Monthly/i);
  assert.doesNotMatch(sql, /club_membership_billing_arrangements\s*\(/i);
  assert.doesNotMatch(sql, /club_membership_billing_obligations\s*\(/i);
});

test("waiting-list exceptions preserve source evidence but remove membership assignment input", () => {
  for (const [row, name] of [[33, "daniel dixon"], [49, "rebecca kiely"]] as const) {
    assert.match(sql, new RegExp(`source_row_number=${row}`));
    assert.match(sql, new RegExp(name));
    assert.match(sql, /'sourceMembershipName',normalized_values->'membershipName','membershipDisposition','waiting_list'/);
  }
  assert.match(sql, /normalized_values=\(normalized_values-'membershipName'\)/);
  assert.match(sql, /profile_only_waiting_list_rows',2/);
});

test("the 225 completed outcomes and Marie's rolling mapping are guarded and preserved", () => {
  assert.match(sql, /success_count<>225 or imported_count<>16\s+or linked_count<>209 or rejected_count<>477/);
  assert.match(sql, /source_row_number=268/);
  assert.match(sql, /marie delaney/);
  assert.match(sql, /Marie Delaney package mapping changed unexpectedly/);
  assert.match(sql, /'preserved_successful_rows',225/);
});

test("all remaining rejected rows fail closed on ambiguous mappings, household contracts or provider references", () => {
  assert.match(sql, /select count\(\*\) from public\.club_member_import_package_mappings pm/);
  assert.match(sql, /<>1;/);
  assert.match(sql, /householdReference/);
  assert.match(sql, /unsupported_households<>0/);
  assert.match(sql, /providerSubscriptionReference/);
  assert.match(sql, /providerCustomerReference/);
  assert.match(sql, /unsupported_provider_refs<>0/);
  assert.match(sql, /identity_conflicts<>0/);
  assert.match(sql, /duplicate_source_refs<>0/);
  assert.match(sql, /club_member_import_identities i/);
});

test("recovery is batch/tenant/identity/idempotency scoped and atomic on incomplete results", () => {
  assert.match(sql, /6bf9d303-525a-4565-88a4-b4121fac7f98/);
  assert.match(sql, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.import'\)/);
  assert.match(sql, /r\.organisation_id=org and r\.batch_id=b\.id/);
  assert.match(sql, /member-import:'\|\|r\.id::text/);
  assert.match(sql, /changed_count<>474/);
  assert.match(sql, /final_rejected<>0 or final_memberships<>475/);
  assert.match(sql, /transaction rolled back/);
  assert.match(sql, /b\.status='completed' and b\.row_count=702 and success_count=702/);
});

test("recovery never writes billing records, preserves only safe counts in its result, and audits the exception set", () => {
  assert.doesNotMatch(sql, /insert\s+into\s+public\.club_membership_billing_(arrangements|obligations)/i);
  assert.match(sql, /'member_import\.approved_exceptions_recovered'/);
  assert.match(sql, /jsonb_build_array\(9,33,49\)/);
  assert.match(sql, /'billing_records_created',false/);
  assert.match(sql, /revoke all on function public\.club_recover_rejected_member_import_batch\(uuid,uuid\) from public,anon/);
  assert.match(sql, /grant execute on function public\.club_recover_rejected_member_import_batch\(uuid,uuid\) to authenticated/);
});

test("Club recovery action is capability-checked and hard-scoped to the dedicated RPC and exact batch", () => {
  assert.match(action, /hasCapability\(org, user\.id, "members\.import"\)/);
  assert.match(action, /const APPROVED_RECOVERY_BATCH_ID = "6bf9d303-525a-4565-88a4-b4121fac7f98"/);
  assert.match(action, /recoverApprovedMemberImportBatchAction\(organisationId: string\)/);
  assert.match(action, /rpc\("club_recover_rejected_member_import_batch"/);
  const recoveryAction = action.slice(action.indexOf("export async function recoverApprovedMemberImportBatchAction"), action.indexOf("export async function stageMemberImportAction"));
  assert.doesNotMatch(recoveryAction, /rpc\("club_execute_member_import_batch"/);
});

test("recovery UI confirms once, locks duplicate submission, and renders actual final outcome counts", () => {
  assert.match(component, /window\.confirm\(/);
  assert.match(component, /setRecoveryAttempted\(true\)/);
  assert.match(component, /disabled=\{pending \|\| recoveryLoading \|\| recoveryAttempted\}/);
  assert.match(component, /\{recoverySummary\.recovered\} rows recovered/);
  assert.match(component, /Skipped: \{recoverySummary\.skipped \?\? "not reported"\}/);
  assert.match(component, /Rejected: \{recoverySummary\.rejected\}/);
  assert.match(component, /Failed: \{recoverySummary\.failed \?\? "not reported"\}/);
  assert.match(action, /error\.code === "55000"/);
  assert.doesNotMatch(action, /setMessage\(.*error\.message/);
});
