import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const optimized = readFileSync("supabase/migrations/2027-02-14-madhouse-member-activation-preview-performance.sql", "utf8");
const applied = readFileSync("supabase/migrations/2027-02-12-madhouse-member-self-service-activation-invitations.sql", "utf8");
const start = optimized.indexOf("create or replace function public.club_preview_madhouse_member_activation_invitations");
const end = optimized.indexOf("revoke all on function public.club_preview_madhouse_member_activation_invitations", start);
const preview = optimized.slice(start, end);

test("performance migration replaces the applied preview RPC and classifies candidates in sets rather than per-row helper calls", () => {
  assert.notEqual(start, -1);
  assert.match(optimized, /club_madhouse_member_activation_candidate_state\(uuid\)/);
  assert.match(preview, /active_memberships as materialized/);
  assert.match(preview, /customer_email_counts as materialized/);
  assert.match(preview, /import_email_counts as materialized/);
  assert.match(preview, /household_customers as materialized/);
  assert.doesNotMatch(preview, /club_madhouse_member_activation_candidate_state\s*\(/);
  assert.match(preview, /latest_invites as materialized/);
  assert.match(preview, /distinct on \(i\.customer_id\)/);
  assert.match(applied, /create or replace function public\.club_preview_madhouse_member_activation_invitations/);
});

test("set-based invitation classifier retains membership, email, household and account-conflict decisions", () => {
  assert.match(preview, /m\.status='active'.*m\.starts_at<=now\(\).*m\.ends_at is null or m\.ends_at>now\(\)/s);
  assert.match(preview, /pe\.entitlement_key='gym_access'/);
  for (const outcome of ["already_linked", "missing_email", "invalid_email", "shared_or_placeholder", "shared_or_ambiguous_email", "account_link_conflict", "eligible"]) {
    assert.match(preview, new RegExp(`'${outcome}'`));
  }
  assert.match(preview, /raw_values->>\(b\.mapping->>'householdReference'\)/);
  assert.match(preview, /shared_contract_id/);
  assert.match(preview, /household_reference/);
  assert.match(preview, /auth_email_conflicts as materialized/);
});

test("preview and queued-send classifiers use matching membership, normalized email and household predicates", () => {
  const original = readFileSync("supabase/migrations/2027-02-12-madhouse-member-self-service-activation-invitations.sql", "utf8");
  const helper = original.slice(original.indexOf("create or replace function public.club_madhouse_member_activation_candidate_state"), original.indexOf("revoke all on function public.club_madhouse_member_activation_candidate_state"));
  const ambiguity = readFileSync("supabase/migrations/2026-11-19-club-auto-link-verified-imported-members.sql", "utf8");
  const ambiguityBody = ambiguity.slice(ambiguity.indexOf("create or replace function public.club_imported_member_email_is_ambiguous"), ambiguity.indexOf("revoke all on function public.club_imported_member_email_is_ambiguous"));
  assert.match(helper, /m\.status='active' and m\.starts_at<=now\(\) and \(m\.ends_at is null or m\.ends_at>now\(\)\)/);
  assert.match(ambiguityBody, /lower\(btrim\(r\.normalized_values->>'email'\)\)=lower\(btrim\(p_email\)\)/);
  assert.match(preview, /lower\(btrim\(coalesce\(r\.normalized_values->>'email',''\)\)\) email,count\(\*\)::integer/);
  assert.match(ambiguityBody, /r\.raw_values->>\(b\.mapping->>'householdReference'\)/);
  assert.match(preview, /r\.raw_values->>\(b\.mapping->>'householdReference'\)/);
  assert.match(helper, /account_link_conflict/);
  assert.match(preview, /account_link_conflict/);
  assert.match(original, /v_state:=public\.club_madhouse_member_activation_candidate_state\(v_customer\.id\)/);
  assert.match(preview, /invite_status in \('failed','expired','revoked'\)/);
});

test("preview remains organisation and management scoped and returns only masked email", () => {
  assert.match(preview, /p_organisation_id<>'fa44592a-1593-4ad3-a621-63a4a4bcbceb'/);
  assert.match(preview, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.link_account'\)/);
  assert.match(preview, /m\.active and m\.role in \('owner','gym_admin'\)/);
  assert.match(preview, /left\(split_part\(email,'@',1\),1\)\|\|'••••@'/);
  assert.doesNotMatch(preview, /jsonb_build_object\([^;]*'email'\s*,\s*email/s);
  assert.match(optimized, /revoke all on function public\.club_preview_madhouse_member_activation_invitations\(uuid\) from public,anon/);
  assert.match(optimized, /grant execute on function public\.club_preview_madhouse_member_activation_invitations\(uuid\) to authenticated/);
});

test("forward migration adds idempotent lookup indexes and an optional read-only plan query", () => {
  assert.equal((optimized.match(/create index if not exists/g) ?? []).length, 5);
  assert.match(optimized, /club_member_import_rows_org_normalized_email_idx/);
  assert.match(optimized, /club_member_import_rows_org_legacy_reference_idx/);
  assert.match(optimized, /club_madhouse_activation_invites_latest_idx/);
  assert.match(optimized, /begin;[\s\S]*commit;/);
  const diagnostic = readFileSync("supabase/diagnostics/club-member-activation-preview-plan.sql", "utf8");
  assert.match(diagnostic, /set local role authenticated/);
  assert.match(diagnostic, /explain \(analyze, buffers, verbose\)/);
  assert.match(diagnostic, /rollback;/);
  assert.doesNotMatch(diagnostic, /insert into|update public\.|delete from|club_queue_madhouse/);
});

test("Production invitation breakdown is read-only, aggregate-only, and reports overlapping identity evidence", () => {
  const diagnostic = readFileSync("supabase/diagnostics/madhouse-zero-eligible-invitation-breakdown.sql", "utf8");
  assert.match(diagnostic, /set transaction read only/);
  assert.match(diagnostic, /same normalized address used by multiple active customers/i);
  assert.match(diagnostic, /collision only with inactive or profile-only customers/i);
  assert.match(diagnostic, /duplicate imported customer profiles/i);
  assert.match(diagnostic, /repeated import rows: one nonblank legacy reference only/i);
  assert.match(diagnostic, /repeated import rows: multiple or missing legacy references/i);
  assert.match(diagnostic, /source household marker/i);
  assert.match(diagnostic, /shared membership contract \/ payer/i);
  assert.match(diagnostic, /different customer is already linked to matching Auth email/i);
  assert.match(diagnostic, /potential staff-review candidates/i);
  assert.match(diagnostic, /select metric,affected_active_customers,distinct_emails from metrics/);
  const returnedShape = diagnostic.slice(diagnostic.lastIndexOf("select metric,affected_active_customers,distinct_emails from metrics"));
  assert.match(returnedShape, /^select metric,affected_active_customers,distinct_emails from metrics order by metric;/);
  assert.doesNotMatch(returnedShape, /display_name|phone|customer_id|invited_email|token/i);
  assert.match(diagnostic, /rollback;/);
});
