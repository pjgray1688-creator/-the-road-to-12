import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canManagerChangeStaffPassword, KEENAN_AUTH_USER_ID, PETER_AUTH_USER_ID } from "../lib/club-staff-password-policy";
import { validateAuthPassword } from "../lib/auth-password-policy";

const actions = readFileSync("app/club/staff/actions.ts", "utf8");
const passwordActions = readFileSync("app/club/staff/password-actions.ts", "utf8");
const accessActions = readFileSync("app/club/access/actions.ts", "utf8");
const accessPage = readFileSync("app/club/my-access/page.tsx", "utf8");
const pinControls = readFileSync("components/club-access-pin-controls.tsx", "utf8");
const passwordComponent = readFileSync("components/club-staff-password-reset.tsx", "utf8");
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

test("PIN stays hidden until explicit reveal; self-reset uses the audited own-customer RPC", () => {
  assert.match(pinControls, /useState<string>\(\)/);
  assert.match(pinControls, /revealMyClubAccessPin\(organisationId\)/);
  assert.match(pinControls, /window\.confirm\("Reset your gym-entry PIN\?/);
  assert.match(accessActions, /club_reissue_person_access_credential/);
  assert.match(accessActions, /p_reason: "Staff member requested their own access PIN reset in Club"/);
  const selfReset = accessActions.slice(accessActions.indexOf("export async function resetMyClubAccessPin"));
  assert.match(selfReset, /p_customer_id: result\.pass\.customerId/);
  assert.doesNotMatch(selfReset, /input\.customerId|targetUserId/);
});

test("only the two immutable management identities may change staff passwords, including Peter's Keenan exception", () => {
  assert.equal(canManagerChangeStaffPassword(PETER_AUTH_USER_ID, "gym_admin", KEENAN_AUTH_USER_ID, "owner"), true);
  assert.equal(canManagerChangeStaffPassword(KEENAN_AUTH_USER_ID, "owner", "staff-1", "gym_staff"), true);
  assert.equal(canManagerChangeStaffPassword(KEENAN_AUTH_USER_ID, "owner", "coach-1", "trainer"), true);
  assert.equal(canManagerChangeStaffPassword(PETER_AUTH_USER_ID, "owner", "manager-1", "gym_admin"), true);
  assert.equal(canManagerChangeStaffPassword("unlisted-manager", "gym_admin", "staff-1", "gym_staff"), false);
  assert.equal(canManagerChangeStaffPassword("unlisted-manager", "owner", KEENAN_AUTH_USER_ID, "owner"), false);
  assert.equal(canManagerChangeStaffPassword(PETER_AUTH_USER_ID, "gym_admin", "other-owner", "owner"), false);
  assert.equal(canManagerChangeStaffPassword(KEENAN_AUTH_USER_ID, "owner", PETER_AUTH_USER_ID, "owner"), false);
  assert.equal(canManagerChangeStaffPassword(KEENAN_AUTH_USER_ID, "owner", KEENAN_AUTH_USER_ID, "owner"), false);
  assert.equal(canManagerChangeStaffPassword("staff", "gym_staff", "coach-1", "trainer"), false);
});

test("manual password validation matches the shared eight-character reset rule", () => {
  assert.equal(validateAuthPassword("eight888"), null);
  assert.equal(validateAuthPassword("short"), "invalid_length");
  assert.equal(validateAuthPassword("validpass", "different"), "mismatch");
  assert.equal(validateAuthPassword("x".repeat(1025)), "invalid_length");
  assert.match(passwordComponent, /New password/);
  assert.match(passwordComponent, /Confirm new password/);
  assert.match(passwordComponent, /Send Password Reset Email/);
});

test("direct password changes are server-authorized, audited without password data, and use Supabase Auth Admin", () => {
  assert.match(passwordActions, /changeStaffPassword/);
  assert.match(passwordActions, /isDirectPasswordManager\(manager\.user\.id\)/);
  assert.match(passwordActions, /staff\.permissions_manage/);
  assert.match(passwordActions, /club_list_staff_accounts/);
  assert.match(passwordActions, /canManagerChangeStaffPassword\(/);
  assert.match(passwordActions, /updateUserById\(input\.targetUserId, \{ password: input\.password, app_metadata: appMetadata \}\)/);
  assert.match(passwordActions, /staff\.password_change\.succeeded/);
  assert.match(passwordActions, /staff\.password_change\.failed/);
  assert.doesNotMatch(passwordActions, /console\.(log|error).*password/i);
  const directChange = passwordActions.slice(passwordActions.indexOf("export async function changeStaffPassword"));
  const auditMetadata = [...directChange.matchAll(/p_metadata:\s*\{([^}]*)\}/g)].map(match => match[1]);
  assert.ok(auditMetadata.length >= 2);
  assert.ok(auditMetadata.every(metadata => !/input\.password|input\.confirmation/.test(metadata)));
  assert.doesNotMatch(actions, /admin\.updateUserById\([^\n]*user_metadata/);
});

test("temporary-password requirement is enforced on protected app routes and cleared only with a verified Auth password update", () => {
  const proxy = readFileSync("proxy.ts", "utf8");
  const forcedAction = readFileSync("app/account/required-password-change/actions.ts", "utf8");
  assert.match(proxy, /data\.user\.app_metadata/);
  assert.match(proxy, /password_change_required === true/);
  assert.match(proxy, /status: 423/);
  assert.match(forcedAction, /client\.auth\.getUser\(\)/);
  assert.match(forcedAction, /admin\.auth\.admin\.getUserById\(user\.id\)/);
  assert.match(forcedAction, /password_change_required !== true/);
  assert.match(forcedAction, /password_change_required: false/);
  assert.match(forcedAction, /password: input\.password/);
  assert.match(forcedAction, /admin\.auth\.admin\.updateUserById\(user\.id/);
  assert.doesNotMatch(forcedAction, /console\.(log|error)|\bp_metadata\s*:|password_change_required: input\.password/);
});

test("secondary reset email requires verified Auth email and uses recovery flow", () => {
  assert.match(passwordActions, /auth\.admin\.getUserById\(input\.targetUserId\)/);
  assert.match(passwordActions, /email_confirmed_at/);
  assert.match(passwordActions, /staff\.password_reset_email\.sent/);
  assert.match(passwordActions, /auth\.resetPasswordForEmail\(email/);
  assert.doesNotMatch(passwordActions, /generateLink|hashed_token|service_role/);
});
