import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-11-27-coach-nutrition-accountability.sql", "utf8");
const reconciliation = readFileSync("supabase/migrations/2026-12-15-coach-nutrition-reconciliation.sql", "utf8");
const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
const member = readFileSync("components/nutrition-member.tsx", "utf8");
const coach = readFileSync("components/coach-nutrition.tsx", "utf8");
const home = readFileSync("components/home-shell.tsx", "utf8");
const postgresWorkflow = readFileSync(".github/workflows/validate-migrations-postgres.yml", "utf8");
const postgresHarness = readFileSync("scripts/validate-coach-nutrition-reconciliation-postgres.sh", "utf8");
const postgresCatalog = readFileSync("tests/sql/nutrition-reconciliation-catalog.sql", "utf8");
const postgresBehavior = readFileSync("tests/sql/nutrition-reconciliation-behavior.sql", "utf8");
const postgresSnapshot = readFileSync("tests/sql/nutrition-reconciliation-snapshot.sql", "utf8");

test("nutrition schema is additive and keeps plans, meals, swaps, supplements and accountability separate", () => {
  for (const table of ["nutrition_plans", "nutrition_targets", "nutrition_meals", "nutrition_meal_items", "nutrition_meal_alternatives", "nutrition_supplements", "nutrition_daily_checkins", "nutrition_extras", "nutrition_coach_feedback"]) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, /unique\(client_user_id,checkin_date\)/);
  assert.match(migration, /status text not null default 'draft' check \(status in \('draft','active','superseded','archived'\)\)/);
  assert.doesNotMatch(migration, /drop table|delete from public\.nutrition_plans/i);
});

test("nutrition authorization distinguishes Primary plan ownership from Cover read access", () => {
  assert.match(migration, /nutrition_can_read_client/);
  assert.match(migration, /nutrition_can_manage_plan/);
  assert.match(migration, /relationship_type='primary'/);
  assert.match(migration, /nutrition_get_coach_view\(p_client_user_id uuid,p_requested_timezone text default null\)/);
  assert.match(migration, /Only the Primary PT can edit this nutrition plan/);
  assert.match(migration, /coachPrivateNotes.*case when p_include_private/);
  assert.match(migration, /draftPlan/);
  assert.match(migration, /owner_coach_user_id=auth\.uid\(\).*status='draft'/);
});

test("plan activation supersedes history atomically and daily check-ins retain first plan attribution", () => {
  assert.match(migration, /nutrition_activate_plan\(p_plan_id uuid\)/);
  assert.match(migration, /update public\.nutrition_plans set status='superseded'/);
  assert.match(migration, /update public\.nutrition_plans set status='active'/);
  assert.match(migration, /on conflict\(client_user_id,checkin_date\) do update/);
  assert.doesNotMatch(migration, /do update set plan_id=excluded\.plan_id/);
  assert.match(migration, /nutrition_safe_timezone\(auth\.uid\(\),p_timezone\)/);
  assert.match(migration, /nutrition_one_current_draft_per_owner/);
});

test("timezone and accountability views are server-derived and include seven missing-aware days", () => {
  assert.match(migration, /from pg_timezone_names/);
  assert.match(migration, /public\.profiles p where p\.id=p_user_id/);
  assert.match(migration, /generate_series\(v_today-6,v_today,interval '1 day'\)/);
  assert.match(migration, /'checkinDays'/);
  assert.match(migration, /'timezone',v_timezone/);
  assert.match(migration, /p_requested_timezone text default null/);
});

test("member nutrition and Today accountability stay in the normal Member surface", () => {
  assert.match(member, /NUTRITION TODAY/);
  assert.match(member, /Add extra/);
  assert.match(member, /update-extra/);
  assert.match(home, /NutritionTodayCard/);
  assert.match(member, /COACH FEEDBACK/);
  assert.doesNotMatch(member, /coach_private_notes|coachPrivateNotes/);
});

test("Coach nutrition includes a real builder, accountability review and feedback", () => {
  assert.match(coach, /PLAN BUILDER/);
  assert.match(coach, /Save draft/);
  assert.match(coach, /Activate plan/);
  assert.match(coach, /LAST 7 DAYS/);
  assert.match(coach, /Leave feedback/);
  assert.match(coach, /Create revised draft/);
  assert.match(coach, /Continue editing/);
  assert.match(coach, /timingText/);
  assert.match(coach, /Meal alternative/);
  assert.match(coach, /Add supplement/);
  assert.match(coach, /sortOrder: mealIndex/);
  assert.match(coach, /sortOrder: index/);
  assert.match(coach, /reorder\(editingDraft\.supplements/);
  assert.match(coach, /checkinDays/);
  assert.doesNotMatch(coach, /toISOString\(\)\.slice\(0,10\)/);
});

test("member projection and API keep private notes out while using the server timezone", () => {
  assert.doesNotMatch(member, /coachPrivateNotes/);
  assert.match(member, /api\/nutrition\?timezone=/);
  assert.match(member, /timezone/);
  assert.match(readFileSync("app/api/nutrition/route.ts", "utf8"), /p_requested_timezone/);
  assert.match(readFileSync("app/api/coach/nutrition/route.ts", "utf8"), /p_requested_timezone/);
});

test("deployment manifest includes nutrition after Coach foundations", () => {
  assert.match(manifest, /2026-11-26-coach-invitation-email-polish\.sql[\s\S]*2026-11-27-coach-nutrition-accountability\.sql/);
});

test("forward reconciliation repairs the broken client-read function and reinstalls the complete RPC contract", () => {
  assert.match(reconciliation, /create or replace function public\.nutrition_can_read_client\(p_client_user_id uuid\)/);
  assert.match(reconciliation, /where a\.client_user_id=p_client_user_id and a\.coach_user_id=auth\.uid\(\) and a\.active\s*\)\s*\)\s*;/);
  for (const name of ["nutrition_can_read_client", "nutrition_can_manage_plan", "nutrition_plan_json", "nutrition_safe_timezone", "nutrition_get_member_view", "nutrition_get_coach_view", "nutrition_save_draft", "nutrition_activate_plan", "nutrition_save_daily_checkin", "nutrition_add_extra", "nutrition_update_extra", "nutrition_delete_extra", "nutrition_leave_feedback"]) {
    assert.match(reconciliation, new RegExp(`create or replace function public\\.${name}\\(`), `${name} must be reconciled`);
  }
  assert.doesNotMatch(reconciliation, /drop table|truncate|delete from public\.nutrition_plans/i);
  assert.match(reconciliation, /on conflict\(client_user_id,checkin_date\) do update[\s\S]*?returning \* into c/);
  assert.doesNotMatch(reconciliation, /do update set[^;]*plan_id=excluded\.plan_id/);
});

test("Nutrition reconciliation keeps SECURITY DEFINER paths pinned and table access RPC-only", () => {
  const functions = [...reconciliation.matchAll(/create or replace function public\.nutrition_[\s\S]*?\$\$;/g)].map(match => match[0]);
  assert.equal(functions.length, 13);
  for (const fn of functions) {
    assert.match(fn, /security definer/i);
    assert.match(fn, /set search_path=pg_catalog,public/i);
  }
  for (const table of ["nutrition_plans", "nutrition_targets", "nutrition_meals", "nutrition_meal_items", "nutrition_meal_alternatives", "nutrition_supplements", "nutrition_daily_checkins", "nutrition_extras", "nutrition_coach_feedback"]) {
    assert.match(reconciliation, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(reconciliation, /from public,anon,authenticated/);
  assert.match(reconciliation, /nutrition_get_member_view\(text\)[\s\S]*?to authenticated/);
  assert.match(reconciliation, /nutrition_get_coach_view\(uuid,text\)[\s\S]*?to authenticated/);
});

test("Nutrition reconciliation closes every function body and follows the existing migration sequence", () => {
  const functions = [...reconciliation.matchAll(/create or replace function public\.nutrition_[\s\S]*?\$\$;/g)].map(match => match[0]);
  for (const fn of functions) {
    const sqlWithoutQuotedStrings = fn.replace(/'(?:''|[^'])*'/g, "''");
    let depth = 0;
    for (const char of sqlWithoutQuotedStrings) {
      if (char === "(") depth++;
      if (char === ")") depth--;
      assert.ok(depth >= 0, "function has an unmatched closing parenthesis");
    }
    assert.equal(depth, 0, "function has an unmatched opening parenthesis");
  }
  assert.match(manifest, /2026-12-14-member-purchase-history\.sql[\s\S]*2026-12-15-coach-nutrition-reconciliation\.sql/);
});

test("Nutrition feedback cannot bind another member’s check-in and organisation-linked Coach access is scoped", () => {
  assert.match(reconciliation, /c\.id=p_checkin_id and c\.client_user_id=p_client_user_id/);
  assert.match(reconciliation, /coach_permissions cp[\s\S]*client_member\.organisation_id=cp\.organisation_id/);
  assert.match(reconciliation, /a\.relationship_type='primary'/);
  assert.match(reconciliation, /coach_private_notes else null/);
});

test("PostgreSQL 16 CI executes all Nutrition recovery states, rerun, catalog and data checks", () => {
  assert.match(postgresWorkflow, /image: postgres:16/);
  assert.match(postgresWorkflow, /pull_request:/);
  assert.match(postgresWorkflow, /push:/);
  assert.match(postgresWorkflow, /Validate Nutrition reconciliation in all recovery states[\s\S]*?scripts\/validate-coach-nutrition-reconciliation-postgres\.sh/);
  for (const prerequisite of ["2026-09-26-coach-safe-workflow.sql", "2026-10-02-club-member-joining.sql", "2026-10-05-coach-organisation-boundary.sql", "2026-11-16-club-staff-permission-model.sql", "2026-11-18-member-acquisition-onboarding.sql", "2026-11-21-notification-engine.sql", "2026-11-23-coach-independent-client-relationships.sql", "2026-11-26-coach-invitation-email-polish.sql"]) {
    assert.ok(postgresWorkflow.includes(prerequisite), `${prerequisite} must be included in the real prerequisite chain`);
  }
  assert.match(postgresHarness, /STATE A[\s\S]*2026-12-15-coach-nutrition-reconciliation\.sql/);
  assert.match(postgresHarness, /STATE B[\s\S]*state-b-pre-error\.sql[\s\S]*2026-12-15-coach-nutrition-reconciliation\.sql/);
  assert.match(postgresHarness, /STATE C[\s\S]*state-c-corrected-11-27\.sql[\s\S]*2026-12-15-coach-nutrition-reconciliation\.sql[\s\S]*nutrition-reconciliation-snapshot\.sql/);
  assert.match(postgresHarness, /nutrition-reconciliation-catalog\.sql/);
  assert.match(postgresHarness, /nutrition-reconciliation-behavior\.sql/);
  assert.match(postgresHarness, /source\.partition\(anchor\)/);
  assert.match(postgresHarness, /source\.replace\(broken, fixed, 1\)/);
  assert.match(postgresHarness, /before"\s*!=\s*"\$after/);
  assert.doesNotMatch(postgresHarness, /write_text\(.*2026-11-27-coach-nutrition-accountability\.sql/);
  for (const table of ["nutrition_plans", "nutrition_targets", "nutrition_meals", "nutrition_meal_items", "nutrition_meal_alternatives", "nutrition_supplements", "nutrition_daily_checkins", "nutrition_extras", "nutrition_coach_feedback"]) {
    assert.match(postgresCatalog, new RegExp(table));
    assert.match(postgresSnapshot, new RegExp(`from public\\.${table}`));
  }
  for (const behavior of ["Unrelated Coach read", "Cross-organisation Coach read", "Cross-organisation Coach wrote", "Cover Coach edited", "Coach-private notes leaked", "Private Coach feedback leaked", "Same-day check-in", "another client check-in", "Club assignment plan context"]) {
    assert.match(postgresBehavior, new RegExp(behavior, "i"));
  }
});
