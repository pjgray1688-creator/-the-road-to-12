import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const correction = readFileSync("supabase/migrations/2026-12-06-madhouse-rota-and-availability.sql", "utf8");
const live = readFileSync("supabase/migrations/2026-12-05-madhouse-shared-scheduling.sql", "utf8");
const functionBody = (sql: string, name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}`);
  const body = sql.indexOf("as $$", start) + 5;
  const end = sql.indexOf("$$;", body);
  assert.ok(start >= 0 && body >= 5 && end > body, `${name} function exists`);
  return sql.slice(body, end);
};

test("no weekly availability configuration and outside-guide appointments do not block PT booking", () => {
  const body = functionBody(correction, "club_save_schedule_event");
  assert.doesNotMatch(body, /club_staff_weekly_working_hours|outside.*working hours|manager_override/);
  assert.match(body, /club_assert_schedule_available/);
  assert.match(correction, /Weekly hours remain an optional guide/);
});

test("explicit diary blocks, approved leave and classes remain authoritative conflicts", () => {
  const checker = functionBody(live, "club_assert_schedule_available");
  assert.match(checker, /club_schedule_events e[\s\S]+e\.status='scheduled'[\s\S]+e\.starts_at<p_ends_at and e\.ends_at>p_starts_at/);
  assert.match(checker, /club_class_sessions c[\s\S]+c\.status='scheduled'[\s\S]+c\.starts_at<p_ends_at and c\.ends_at>p_starts_at/);
  assert.match(functionBody(correction, "club_review_leave_request"), /club_assert_schedule_available/);
  assert.match(correction, /'other_location','admin_time'/);
});

test("rota shifts are separate, location-scoped records and are excluded from booking conflicts", () => {
  assert.match(correction, /create table if not exists public\.club_staff_rota_shifts/);
  assert.match(correction, /work_date date not null[\s\S]+starts_at time not null[\s\S]+ends_at time not null[\s\S]+location_id uuid not null/);
  assert.match(correction, /foreign key \(location_id,organisation_id\) references public\.club_locations\(id,organisation_id\)/);
  assert.match(correction, /lower\(name\) like '%rotherham%' or lower\(name\) like '%carlton%'/);
  assert.doesNotMatch(functionBody(live, "club_assert_schedule_available"), /club_staff_rota_shifts/);
  assert.doesNotMatch(functionBody(correction, "club_save_schedule_event"), /club_staff_rota_shifts/);
});

test("rota management uses management capability, preserves actor history and only cancels shifts", () => {
  const save = functionBody(correction, "club_save_rota_shift");
  assert.match(save, /club_has_active_role\(p_organisation_id,array\['gym_admin','owner'\]\)/);
  assert.match(save, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'classes\.manage'\)/);
  assert.match(save, /club_audit_events/);
  assert.match(functionBody(correction, "club_cancel_rota_shift"), /status='cancelled'/);
  assert.match(functionBody(correction, "club_list_shared_schedule"), /manager or r\.staff_user_id=auth\.uid\(\)/);
  assert.match(functionBody(correction, "club_list_rota_staff"), /m\.role in \('trainer','gym_staff','gym_admin','owner'\)/);
});

test("Coach diary edits remain self-scoped and organisation-scoped", () => {
  const save = functionBody(live, "club_save_schedule_event");
  assert.match(save, /self_trainer:=public\.club_has_active_role\(p_organisation_id,array\['trainer'\]\) and p_staff_user_id=auth\.uid\(\)/);
  assert.match(save, /existing\.staff_user_id<>auth\.uid\(\)/);
  const replacement = functionBody(correction, "club_save_schedule_event");
  assert.match(replacement, /p_organisation_id/);
  assert.match(replacement, /self_trainer:=public\.club_has_active_role/);
  assert.match(replacement, /where id=p_id and organisation_id=p_organisation_id/);
});

test("holiday requests are pending until manager approval creates a blocking leave event", () => {
  assert.match(correction, /status text not null default 'requested' check \(status in \('requested','approved','declined','cancelled'\)\)/);
  assert.match(functionBody(correction, "club_submit_leave_request"), /staff_user_id,starts_at,ends_at,request_note,created_by/);
  assert.match(functionBody(correction, "club_review_leave_request"), /array\['gym_admin','owner'\]/);
  assert.match(functionBody(correction, "club_review_leave_request"), /if p_decision='approved' then[\s\S]+club_assert_schedule_available[\s\S]+event_type,staff_user_id,title/);
  assert.match(functionBody(correction, "club_cancel_leave_request"), /update public\.club_schedule_events set status='cancelled'/);
});

test("private-client PT sessions and existing member notifications are preserved", () => {
  const save = functionBody(correction, "club_save_schedule_event");
  assert.match(save, /private_client_id/);
  assert.match(save, /club_member_notification_intents/);
  assert.match(correction, /private_client_id is not null and not \(can_notes or e\.staff_user_id=auth\.uid\(\)\) then 'PT session'/);
});

test("Member schedule remains limited to linked PT appointments and confirmed class bookings", () => {
  const memberRead = functionBody(live, "club_list_my_schedule");
  assert.match(memberRead, /club_schedule_events e[\s\S]+e\.event_type='pt_session'/);
  assert.match(memberRead, /club_class_bookings/);
  assert.doesNotMatch(memberRead, /club_staff_rota_shifts|club_schedule_leave_requests|club_staff_weekly_working_hours/);
});

test("deployment manifest orders the correction after the already-live schedule model", () => {
  const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
  assert.ok(manifest.indexOf("2026-12-05-madhouse-shared-scheduling.sql") < manifest.indexOf("2026-12-06-madhouse-rota-and-availability.sql"));
  assert.match(correction, /on conflict|create table if not exists/);
});
