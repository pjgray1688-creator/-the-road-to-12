import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveClubCapabilities } from "@/lib/club-capabilities";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/2026-11-17-club-staff-account-onboarding.sql");
const actions = read("app/club/staff/actions.ts");
const form = read("components/club-staff-access-form.tsx");
const staffPage = read("app/club/staff/page.tsx");
const claimPage = read("app/club/staff/claim/page.tsx");
const accountPage = read("app/account/page.tsx");
const resetPage = read("app/account/reset/page.tsx");
const bootstrap = read("docs/manual-sql/madhouse-first-organisation-bootstrap.sql");

test("manager prepares PT and operational invitations with server-derived packages", () => {
  assert.match(form, /<option value="gym_staff">Operational Staff<\/option>/);
  assert.match(form, /<option value="trainer">PT<\/option>/);
  assert.match(form, /Enable Coach\/PT access when this person accepts/);
  assert.match(actions, /const expected = resolveClubCapabilities\(input\.role\)/);
  assert.match(actions, /p_capabilities: expected/);
  assert.deepEqual(resolveClubCapabilities("trainer"), resolveClubCapabilities("gym_staff"));
  assert.match(actions, /input\.coachRequested && input\.role === "gym_staff"/);
});

test("claim requires the authenticated account email and exact canonical package", () => {
  assert.match(migration, /select lower\(email\),coalesce\(raw_user_meta_data/);
  assert.match(migration, /email_normalized=lower\(btrim\(account_email\)\)/);
  assert.match(migration, /Staff access grant is unavailable for this account/);
  assert.match(migration, /g\.capabilities is distinct from public\.club_capabilities_for_role\(g\.intended_role\)/);
  assert.match(claimPage, /club_list_my_pending_staff_access/);
  assert.match(claimPage, /Accept staff access/);
});

test("duplicate pending and active same-email invitations are rejected within the organisation", () => {
  assert.match(migration, /m\.organisation_id=p_organisation_id[\s\S]*lower\(btrim\(p\.email\)\)=normalized_email/);
  assert.match(migration, /m\.role in \('owner','gym_admin','gym_staff','trainer'\)/);
  assert.match(migration, /organisation_id=p_organisation_id and email_normalized=normalized_email and status='pending'/);
  assert.match(migration, /Staff access is already pending for this email/);
  assert.match(migration, /club_staff_access_grants_pending_key|status='pending'/);
});

test("claim creates the real profile and organisation staff membership without creating Auth users", () => {
  assert.match(migration, /insert into public\.profiles\(id,email,display_name,first_name,last_name\)/);
  assert.match(migration, /insert into public\.club_members\(organisation_id,user_id,role,active\)/);
  assert.match(migration, /values\(g\.organisation_id,auth\.uid\(\),g\.intended_role,true\)/);
  assert.match(migration, /on conflict \(organisation_id,user_id\) do update set role=excluded\.role,active=true/);
  assert.match(migration, /This account already has active staff access/);
  assert.doesNotMatch(migration, /insert into auth\.users/i);
  assert.doesNotMatch(actions, /service[_-]?role|auth\.admin/i);
});

test("claim and pending reads remain account and organisation scoped", () => {
  assert.match(migration, /where id=p_grant_id and status='pending'/);
  assert.match(migration, /g\.organisation_id,auth\.uid\(\),g\.intended_role/);
  assert.match(migration, /g\.email_normalized=lower\(btrim\(coalesce\(auth\.jwt\(\)->>'email',''\)\)\)/);
  assert.match(migration, /where m\.organisation_id=p_organisation_id and m\.role in/);
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'staff\.permissions_manage'\)/);
});

test("Coach intent becomes explicit only at claim and roles never imply it", () => {
  assert.match(migration, /add column if not exists coach_requested boolean not null default false/);
  assert.match(migration, /insert into public\.coach_permissions\(organisation_id,user_id,granted_by,active\)/);
  assert.match(migration, /values\(g\.organisation_id,auth\.uid\(\),g\.created_by,g\.coach_requested\)/);
  assert.match(migration, /g\.coach_requested and g\.intended_role not in \('gym_admin','trainer'\)/);
  assert.equal(resolveClubCapabilities("gym_admin").includes("staff.permissions_manage"), true);
  assert.equal(resolveClubCapabilities("trainer").includes("staff.permissions_manage"), false);
  assert.doesNotMatch(resolveClubCapabilities.toString(), /coach/i);
  assert.match(staffPage, /Coach\/PT \{row\.coach_requested \? "will be enabled" : "not requested"\}/);
});

test("revocation, owner protection, suspension and reactivation use existing authoritative RPCs", () => {
  assert.match(staffPage, /Cancel invitation/);
  assert.match(actions, /club_revoke_staff_access_grant/);
  assert.match(actions, /club_set_staff_active/);
  assert.match(staffPage, /Suspend staff access/);
  assert.match(staffPage, /Reactivate staff access/);
  const permissionMigration = read("supabase/migrations/2026-11-16-club-staff-permission-model.sql");
  assert.match(permissionMigration, /if current_role='owner' then raise exception 'Owner role is protected'/);
  assert.match(permissionMigration, /The organisation must retain an active owner/);
});

test("all onboarding and Coach audit actors come from auth.uid", () => {
  assert.match(migration, /'staff\.access_grant_created'[\s\S]*from public\.club_members m where m\.organisation_id=p_organisation_id and m\.user_id=auth\.uid\(\)/);
  assert.match(migration, /g\.organisation_id,auth\.uid\(\),g\.intended_role,'staff\.access_grant_claimed'/);
  assert.match(migration, /p_organisation_id,auth\.uid\(\),actor_role,'coach\.access_changed'/);
  assert.doesNotMatch(migration, /p_actor_user_id/);
});

test("password creation and recovery remain private Supabase Auth operations", () => {
  assert.match(accountPage, /signUp\(\{ email, password/);
  assert.match(accountPage, /signInWithPassword\(\{ email, password \}\)/);
  assert.match(accountPage, /resetPasswordForEmail\(email/);
  assert.match(resetPage, /auth\.updateUser\(\{ password \}\)/);
  assert.doesNotMatch(actions, /password/i);
  assert.doesNotMatch(staffPage, /set password|temporary password|view password/i);
});

test("gym membership intent is informational and membership remains a separate workflow", () => {
  assert.match(migration, /add column if not exists member_intent boolean not null default false/);
  assert.match(form, /This is a note only\. Gym membership is created separately/);
  assert.match(staffPage, /Gym membership:/);
  assert.doesNotMatch(migration, /insert into public\.club_memberships/);
  assert.doesNotMatch(migration, /insert into public\.club_membership_holders/);
});

test("first Madhouse bootstrap is explicit, idempotent and never fabricates identity or entitlements", () => {
  assert.match(bootstrap, /REPLACE_WITH_EXISTING_AUTH_USER_UUID/);
  assert.match(bootstrap, /REPLACE_WITH_EXISTING_AUTH_USER_EMAIL/);
  assert.match(bootstrap, /from auth\.users[\s\S]*id=v_user_id/);
  assert.match(bootstrap, /values\('Madhouse Gym','madhouse-gym',true\)/);
  assert.match(bootstrap, /values\(v_organisation_id,'Rotherham',true\)/);
  assert.match(bootstrap, /values\(v_organisation_id,v_user_id,'gym_admin',true\)/);
  assert.doesNotMatch(bootstrap, /insert into auth\.users/i);
  assert.doesNotMatch(bootstrap, /club_memberships|club_membership_holders/);
  assert.match(bootstrap, /v_grant_coach boolean := false/);
});
