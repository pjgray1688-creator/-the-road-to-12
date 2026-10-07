import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-11-27-coach-nutrition-accountability.sql", "utf8");
const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
const member = readFileSync("components/nutrition-member.tsx", "utf8");
const coach = readFileSync("components/coach-nutrition.tsx", "utf8");
const home = readFileSync("components/home-shell.tsx", "utf8");

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
  assert.match(migration, /nutrition_get_coach_view\(p_client_user_id uuid\)/);
  assert.match(migration, /Only the Primary PT can edit this nutrition plan/);
  assert.match(migration, /coachPrivateNotes.*case when p_include_private/);
});

test("plan activation supersedes history atomically and daily check-ins are timezone-aware upserts", () => {
  assert.match(migration, /nutrition_activate_plan\(p_plan_id uuid\)/);
  assert.match(migration, /update public\.nutrition_plans set status='superseded'/);
  assert.match(migration, /update public\.nutrition_plans set status='active'/);
  assert.match(migration, /on conflict\(client_user_id,checkin_date\) do update/);
  assert.match(migration, /now\(\) at time zone coalesce\(nullif\(p_timezone/);
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
});

test("deployment manifest includes nutrition after Coach foundations", () => {
  assert.match(manifest, /2026-11-26-coach-invitation-email-polish\.sql[\s\S]*2026-11-27-coach-nutrition-accountability\.sql/);
});
