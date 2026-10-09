import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(path, "utf8");

test("Coach Diary is a Coach-authorised route scoped to the signed-in staff member and organisation", () => {
  const page = source("app/coach/diary/page.tsx");
  assert.match(page, /coach_has_access/);
  assert.match(page, /listClubOrganisationContexts/);
  assert.match(page, /p_staff_user_id: user\.id/);
  assert.match(page, /club_list_shared_schedule/);
  assert.match(page, /context\.organisation\.id/);
  assert.match(page, /role\)/);
});

test("Coach navigation and home provide a first-class Diary destination and compact schedule glance", () => {
  const nav = source("components/coach-navigation.tsx");
  const workspace = source("components/coach-workspace.tsx");
  const appNav = source("components/app-nav.tsx");
  assert.match(nav, /Diary/);
  assert.match(nav, /\/coach\/diary/);
  assert.match(workspace, /CoachScheduleSummary/);
  assert.match(workspace, /Next on your schedule/);
  assert.match(workspace, /View diary/);
  assert.match(appNav, /pathname\.startsWith\("\/coach\/"\)/);
});

test("Coach Diary reuses live schedule actions, day agenda, blocks, leave and own rota without rota edits", () => {
  const page = source("app/coach/diary/page.tsx");
  const calendar = source("components/club-schedule-calendar.tsx");
  assert.match(page, /<ClubScheduleCalendar/);
  assert.match(page, /canManageRota=\{false\}/);
  assert.match(page, /workingHours=\{workingHours\}/);
  assert.match(calendar, /coachMode\?"My diary"/);
  assert.match(calendar, /DAY VIEW/);
  assert.match(calendar, /shiftDay\(date,coachMode\?-1:-7\)/);
  assert.match(calendar, /Request leave/);
  assert.match(calendar, /Usual availability/);
  assert.match(calendar, /saveScheduleEventAction/);
  assert.match(calendar, /cancelRotaShiftAction/);
});

test("Coach booking continues to distinguish members from private clients and safely handles conflicts", () => {
  const calendar = source("components/club-schedule-calendar.tsx");
  const actions = source("app/club/schedule/actions.ts");
  assert.match(calendar, /R12 member/);
  assert.match(calendar, /Private client/);
  assert.match(calendar, /createSchedulePrivateClientAction/);
  assert.match(actions, /club_search_schedule_members/);
  assert.match(actions, /club_search_schedule_private_clients/);
  assert.match(actions, /club_create_schedule_private_client/);
  assert.match(actions, /already booked or unavailable/);
});

test("Coach Diary has a mobile date strip and safe empty/loading/error states", () => {
  const calendarCss = source("components/club-schedule-calendar.module.css");
  const diaryCss = source("components/coach-diary.module.css");
  const page = source("app/coach/diary/page.tsx");
  assert.match(calendarCss, /\.dateStrip/);
  assert.match(calendarCss, /@media\(max-width:720px\)/);
  assert.match(diaryCss, /@media\(max-width:600px\)/);
  assert.match(page, /Your diary couldn’t be loaded/);
  assert.match(page, /No Madhouse diary is linked yet/);
});

test("Member schedule privacy is unchanged and Member and Coach guides cover scheduling", () => {
  const scheduleMigration = source("supabase/migrations/2026-12-05-madhouse-shared-scheduling.sql");
  const memberStart = scheduleMigration.indexOf("create or replace function public.club_list_my_schedule(");
  const memberEnd = scheduleMigration.indexOf("create or replace function public.club_list_schedule_staff(", memberStart);
  const memberRpc = scheduleMigration.slice(memberStart, memberEnd);
  const memberGuide = source("components/scheduling-user-guide.tsx");
  const tutorialMember = source("app/tutorial/member/page.tsx");
  const tutorialCoach = source("app/tutorial/coach/page.tsx");
  assert.match(memberRpc, /club_class_bookings/);
  assert.doesNotMatch(memberRpc, /club_staff_rota_shifts|club_schedule_leave_requests|club_staff_weekly_working_hours|private_client/);
  assert.match(memberGuide, /Up Next/);
  assert.match(memberGuide, /My Schedule/);
  assert.match(memberGuide, /aren’t self-bookable/);
  assert.match(memberGuide, /Rota shifts are gym staffing records/);
  assert.match(memberGuide, /Pending approval/);
  assert.match(tutorialMember, /SchedulingUserGuide audience="member"/);
  assert.match(tutorialCoach, /SchedulingUserGuide audience="coach"/);
});
