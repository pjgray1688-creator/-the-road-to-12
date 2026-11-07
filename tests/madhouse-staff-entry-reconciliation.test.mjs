import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-12-15-madhouse-staff-entry-access-reconciliation.sql", "utf8");
const staffPage = readFileSync("app/club/staff/page.tsx", "utf8");
const pageStyles = readFileSync("components/club-staff-management.module.css", "utf8");
const staffManage = readFileSync("components/club-staff-manage-access.tsx", "utf8");
const staffStyles = readFileSync("components/club-staff-manage-access.module.css", "utf8");
const membersDirectory = readFileSync("components/club-members-directory.tsx", "utf8");

test("activation control is rendered alongside the verified-account notice and stays manager-gated", () => {
  assert.match(staffPage, /row\.existing_account_verified \? <>[\s\S]*Verified R12 account found[\s\S]*ClubStaffInviteActivation/);
  assert.match(staffPage, /className=\{staffStyles\.activationControl\}/);
  assert.match(pageStyles, /activationControl :global\(\.staff-invite-activation button\)/);
});

test("Madhouse active staff entry identity is organisation-scoped, derived, and membership-independent", () => {
  assert.match(migration, /organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid/);
  assert.match(migration, /role in \('owner','gym_admin','gym_staff','trainer'\)/);
  assert.match(migration, /club_ensure_person_access_credentials/);
  assert.match(migration, /club_refresh_customer_access_projection/);
  assert.match(migration, /lower\(btrim\(l\.name\)\) in \('rotherham','carlton'\)/);
  assert.match(migration, /create or replace function public\.club_refresh_customer_access_projection/);
  assert.match(migration, /is_active_staff:=coalesce\(cardinality\(staff_locations\),0\)=2/);
  assert.doesNotMatch(migration, /insert into public\.club_memberships|update public\.club_memberships|delete from public\.club_memberships/);
});

test("staff access status includes shared evaluator and Club directory separates paid membership", () => {
  assert.match(migration, /return jsonb_build_object\('state','active','reason','active_staff'/);
  assert.match(migration, /v_access->>'reason'='active_staff'/);
  assert.match(membersDirectory, /Staff · no paid membership/);
  assert.match(membersDirectory, /accessLabel\(member\.accessState\)/);
});

test("staff Manage panel is light, readable, and distinguishes role, Coach, entry, and paid membership", () => {
  assert.match(staffManage, /Club staff role/);
  assert.match(staffManage, /Coach permission/);
  assert.match(staffManage, /Paid gym membership/);
  assert.match(staffManage, /Staff gym access: Rotherham and Carlton/);
  assert.match(staffStyles, /background: #fff/);
  assert.match(staffStyles, /color: #20202a/);
});

test("activation uses the existing grant RPC without accepting a target user ID from the page", () => {
  const activation = readFileSync("components/club-staff-invite-activation.tsx", "utf8");
  assert.match(activation, /Activate existing account/);
  assert.match(activation, /activateExistingStaffAccessGrant\(\{ organisationId, grantId \}\)/);
  assert.doesNotMatch(staffPage, /p_user_id:\s*String\(row\./);
});
