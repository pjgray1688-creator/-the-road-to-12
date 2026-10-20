import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/2026-12-14-club-induction-stage-progress.sql", "utf8");
const actions = readFileSync("app/club/induction/actions.ts", "utf8");
const component = readFileSync("components/club-member-induction-completion.tsx", "utf8");

test("induction stage progress is private, member/version scoped and audit attributed", () => {
  assert.match(migration, /create table if not exists public\.club_member_induction_stage_checks/);
  assert.match(migration, /alter table public\.club_member_induction_stage_checks enable row level security/);
  assert.match(migration, /revoke all on table public\.club_member_induction_stage_checks from public, anon, authenticated/);
  assert.match(migration, /checked_by uuid not null references auth\.users/);
  assert.match(migration, /club_append_audit_event\(p_organisation_id,'induction\.stage_completed'/);
});

test("only required sections in the published policy version can be checked", () => {
  assert.match(migration, /status='published' and x\.effective_at<=now\(\)/);
  assert.match(migration, /x\.id=p_section_id and x\.version_id=v\.id and x\.requires_acknowledgement/);
  assert.match(migration, /not public\.club_capability_allowed\(p_organisation_id,auth\.uid\(\),'induction\.perform'\)/);
  assert.match(actions, /club_record_customer_induction_stage/);
  assert.match(component, /section\.required/);
  assert.match(component, /disabled=\{section\.complete \|\| pending\}/);
});

test("booking and imported-customer finalisation reject unfinished required stages", () => {
  assert.equal((migration.match(/r12_induction_required_stages_complete\(p_organisation_id/g) ?? []).length, 2);
  assert.equal((migration.match(/Complete every required induction stage before final completion/g) ?? []).length, 2);
  assert.match(component, /disabled=\{pending \|\| !allRequiredComplete\}/);
  assert.match(migration, /induction\.completed/);
});

test("location policy precedence matches the existing configured access policy", () => {
  assert.match(migration, /x\.location_id=p_location_id or \(x\.location_id is null and not exists \(select 1 from public\.club_induction_policies specific/);
  assert.match(migration, /order by \(x\.location_id is not null\) desc limit 1/);
});

test("legacy bookings without a pinned version fail closed for staff review", () => {
  assert.match(migration, /if v_booking\.version_id is null then raise exception 'This booking has no published induction version and needs staff review'/);
});
