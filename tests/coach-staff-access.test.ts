import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync("supabase/migrations/2026-10-05-coach-staff-access-management.sql", "utf8");
const staffActions = fs.readFileSync("app/club/staff/actions.ts", "utf8");
const staffPage = fs.readFileSync("app/club/staff/page.tsx", "utf8");
const coachAccessRoute = fs.readFileSync("app/api/coach/access/route.ts", "utf8");
const coachBoundary = fs.readFileSync("supabase/migrations/2026-10-05-coach-organisation-boundary.sql", "utf8");

test("authorised staff-permission managers can grant and revoke existing Coach permission", () => {
  assert.match(migration, /create or replace function public\.coach_grant_permission\(p_organisation_id uuid, p_user_id uuid, p_active boolean\)/i);
  assert.match(migration, /club_capability_allowed\(p_organisation_id, auth\.uid\(\), 'staff\.permissions_manage'\)/i);
  assert.match(migration, /values\(p_organisation_id,p_user_id,auth\.uid\(\),p_active\)/i);
  assert.match(migration, /on conflict \(organisation_id,user_id\) do update set active=excluded\.active/i);
  assert.match(staffActions, /coach_grant_permission/);
  assert.match(staffActions, /p_active: input\.active/);
});

test("ordinary staff cannot administer Coach access", () => {
  assert.match(migration, /raise exception 'Coach permission administration denied' using errcode='42501'/i);
  assert.doesNotMatch(migration, /club_has_active_role\(p_organisation_id,array\['gym_staff'/i);
  assert.match(staffActions, /hasCapability\(context\.organisation\.id, user\.id, "staff\.permissions_manage"\)/);
});

test("authorised owners and managers may explicitly grant themselves Coach access", () => {
  assert.doesNotMatch(migration, /p_user_id\s*(?:<>|is distinct from)\s*auth\.uid\(\)/i);
  assert.match(migration, /active and role in \('trainer','gym_admin','owner'\)/i);
  assert.match(staffPage, /\["trainer", "gym_admin", "owner"\]\.includes\(member\.role\)/);
  assert.match(staffPage, /userId: member\.userId, active: !coachEnabled/);
});

test("Coach permission grants and status reads stay within the selected organisation", () => {
  assert.match(migration, /primary key \(organisation_id, user_id\)|on conflict \(organisation_id,user_id\)/i);
  assert.match(migration, /where p\.organisation_id=p_organisation_id/i);
  assert.match(migration, /organisation_id=p_organisation_id and user_id=p_user_id/i);
  assert.match(staffPage, /p_organisation_id: context\.organisation\.id/);
  assert.match(staffActions, /p_organisation_id: context\.organisation\.id/);
});

test("eligible roles do not inherit Coach access while ordinary staff and members stay excluded", () => {
  assert.match(migration, /m\.active and m\.role in \('trainer','gym_admin','owner'\)/i);
  assert.match(migration, /active and role in \('trainer','gym_admin','owner'\)/i);
  assert.doesNotMatch(migration, /role in \([^)]*'gym_staff'/i);
  assert.doesNotMatch(migration, /role in \([^)]*'member'/i);
  assert.match(coachBoundary, /coach_member\.active and coach_member\.role='trainer'/i);
  assert.match(coachBoundary, /p\.active and a\.active/i);
});

test("Club staff UI reports enabled, disabled and ineligible Coach states", () => {
  assert.match(staffPage, /Coach\/PT: \{coachEligible \? coachEnabled \? "Enabled" : "Disabled" : "Not eligible"\}/);
  assert.match(staffPage, /Grant Coach access/);
  assert.match(staffPage, /Revoke Coach access/);
  assert.match(staffPage, /coachEligible && canManageCoach/);
  assert.match(staffPage, /\["trainer", "gym_admin", "owner"\]\.includes\(member\.role\)/);
});

test("the existing Coach access contract observes permission activation and revocation", () => {
  assert.match(coachAccessRoute, /coach_has_access/);
  assert.match(coachAccessRoute, /allowed: Boolean\(data\)/);
  assert.match(migration, /where p\.user_id=auth\.uid\(\) and p\.active/i);
  assert.match(migration, /p_client_user_id is null or exists/i);
  assert.match(migration, /a\.organisation_id=p\.organisation_id and a\.coach_user_id=p\.user_id and a\.client_user_id=p_client_user_id and a\.active/i);
});
