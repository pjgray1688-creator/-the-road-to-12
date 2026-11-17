import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canManagerResetStaffPassword } from "../lib/club-staff-password-policy";

const actions = readFileSync("app/club/staff/actions.ts", "utf8");
const accessActions = readFileSync("app/club/access/actions.ts", "utf8");
const accessPage = readFileSync("app/club/my-access/page.tsx", "utf8");
const pinControls = readFileSync("components/club-access-pin-controls.tsx", "utf8");
const authMigration = readFileSync("supabase/migrations/2026-12-04-member-pin-qr-access-pass.sql", "utf8");
const staffAccessMigration = readFileSync("supabase/migrations/2026-12-15-madhouse-staff-entry-access-reconciliation.sql", "utf8");

test("Madhouse staff access uses the signed-in user's credential RPC without a paid-membership lookup", () => {
  assert.match(accessPage, /resolveClubOperationalContext\(supabase, user\.id/);
  assert.match(accessPage, /club_get_my_access_pass/);
  assert.doesNotMatch(accessPage, /club_get_member_billing|club_get_member_operational_profile|memberships\.view/);
  const ownPass = authMigration.slice(authMigration.indexOf("create or replace function public.club_get_my_access_pass"), authMigration.indexOf("create or replace function public.club_reissue_person_access_credential"));
  assert.match(ownPass, /auth\.uid\(\)/);
  assert.match(ownPass, /where organisation_id=p_organisation_id and user_id=auth\.uid\(\)/);
  const staffProjection = staffAccessMigration.slice(staffAccessMigration.indexOf("create or replace function public.club_refresh_customer_access_projection"), staffAccessMigration.indexOf("create or replace function public.club_evaluate_member_access"));
  assert.match(staffProjection, /staff\.active and staff\.role in \('owner','gym_admin','gym_staff','trainer'\)/);
  assert.match(staffProjection, /'active_staff'/);
});

test("PIN is hidden until a signed-in staff member explicitly reveals it; reset is explicit and audited by the existing RPC", () => {
  assert.match(pinControls, /useState<string>\(\)/);
  assert.match(pinControls, /revealMyClubAccessPin\(organisationId\)/);
  assert.match(pinControls, /window\.confirm\("Reset your gym-entry PIN\?/);
  assert.match(accessActions, /club_reissue_person_access_credential/);
  assert.match(accessActions, /p_reason: "Staff member requested their own access PIN reset in Club"/);
  const selfReset = accessActions.slice(accessActions.indexOf("export async function resetMyClubAccessPin"));
  assert.match(selfReset, /p_customer_id: result\.pass\.customerId/);
  assert.doesNotMatch(selfReset, /input\.customerId|targetUserId/);
  assert.match(selfReset, /return \{ ok: true as const \};/);
});

test("management password-reset hierarchy blocks self-reset and higher-privilege targets", () => {
  assert.equal(canManagerResetStaffPassword("gym_admin", "gym_staff", "manager", "staff"), true);
  assert.equal(canManagerResetStaffPassword("gym_admin", "trainer", "manager", "coach"), true);
  assert.equal(canManagerResetStaffPassword("gym_admin", "gym_admin", "manager", "other-manager"), false);
  assert.equal(canManagerResetStaffPassword("gym_admin", "owner", "manager", "owner"), false);
  assert.equal(canManagerResetStaffPassword("owner", "gym_admin", "owner", "manager"), true);
  assert.equal(canManagerResetStaffPassword("owner", "owner", "owner", "other-owner"), false);
  assert.equal(canManagerResetStaffPassword("gym_staff", "trainer", "staff", "coach"), false);
  assert.equal(canManagerResetStaffPassword("owner", "trainer", "same", "same"), false);
});

test("password-reset action checks manager capability, account hierarchy, verified Auth email, audit and Supabase recovery flow", () => {
  assert.match(actions, /staffManager\(input\.organisationId\)/);
  assert.match(actions, /staff\.permissions_manage/);
  assert.match(actions, /club_list_staff_accounts/);
  assert.match(actions, /canManagerResetStaffPassword\(/);
  assert.match(actions, /auth\.admin\.getUserById\(input\.targetUserId\)/);
  assert.match(actions, /email_confirmed_at/);
  assert.match(actions, /club_append_audit_event/);
  assert.match(actions, /staff\.password_reset\.initiated/);
  assert.match(actions, /auth\.resetPasswordForEmail\(email/);
  assert.doesNotMatch(actions, /admin\.updateUserById|generateLink|hashed_token|service_role/);
});
