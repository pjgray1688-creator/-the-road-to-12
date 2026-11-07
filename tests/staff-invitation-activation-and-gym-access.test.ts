import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-11-07-staff-invitation-onboarding-and-gym-access.sql", "utf8");
const staffActions = readFileSync("app/club/staff/actions.ts", "utf8");
const staffPage = readFileSync("app/club/staff/page.tsx", "utf8");
const activation = readFileSync("components/club-staff-invite-activation.tsx", "utf8");
const autoClaim = readFileSync("components/club-staff-grant-auto-claim.tsx", "utf8");
const accessResolver = readFileSync("supabase/migrations/2026-12-13-member-age-induction-access-eligibility.sql", "utf8");

test("invitation claims require the same authenticated verified email and unexpired pending grant", () => {
  assert.match(migration, /select lower\(email\),email_confirmed_at into account_email,confirmed_at from auth\.users where id=auth\.uid\(\)/);
  assert.match(migration, /confirmed_at is null/);
  assert.match(migration, /g\.status<>'pending' or g\.expires_at<=now\(\)/);
  assert.match(migration, /account_email is distinct from g\.email_normalized/);
  assert.match(migration, /for update/);
  assert.match(autoClaim, /claimStaffAccessGrant\(grantId\)/);
});

test("claims are replay-safe and use one shared idempotent provisioning function", () => {
  assert.match(migration, /club_provision_staff_access_grant_internal/);
  assert.match(migration, /g\.status='accepted' and g\.accepted_by=p_user_id/);
  assert.match(migration, /already_provisioned',true/);
  assert.match(migration, /club_claim_staff_access_grant\(p_grant_id uuid\)/);
  assert.match(migration, /club_activate_existing_staff_access_grant/);
  assert.match(migration, /status='accepted',accepted_by=p_user_id,accepted_at=now\(\)/);
  assert.match(migration, /staff\.access_grant_activated_existing_account/);
  assert.match(migration, /target_user_id',p_user_id/);
});

test("only authorised managers can activate a pending grant for an existing verified account", () => {
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'staff\.permissions_manage'\)/);
  assert.match(migration, /g\.organisation_id=p_organisation_id and g\.status='pending' and g\.expires_at>now\(\)/);
  assert.match(migration, /lower\(u\.email\)=g\.email_normalized and u\.email_confirmed_at is not null/);
  assert.match(migration, /club_list_pending_staff_invites_for_management/);
  assert.match(staffPage, /club_list_pending_staff_invites_for_management/);
  assert.match(staffPage, /row\.existing_account_verified \? <ClubStaffInviteActivation/);
  assert.match(activation, /activateExistingStaffAccessGrant\(\{ organisationId, grantId \}\)/);
  assert.doesNotMatch(staffActions, /activateExistingStaffAccessGrant\(input: \{[^}]*userId/);
});

test("staff-only projection is restricted to active Madhouse staff and the two active gym locations", () => {
  assert.match(migration, /p_organisation_id='fa44592a-1593-4ad3-a621-63a4a4bcbceb'::uuid/);
  assert.match(migration, /staff\.active\s+and staff\.role in \('owner','gym_admin','gym_staff','trainer'\)/);
  assert.match(migration, /lower\(l\.name\) in \('rotherham','carlton'\)/);
  assert.match(migration, /club_staff_member_access_projection_refresh/);
  assert.match(migration, /'active_staff'::text,'locations'::text/);
  assert.match(migration, /why:='active_staff'/);
  assert.match(migration, /case when candidate\.source='active_staff' then 1 else 0 end asc/);
  assert.match(accessResolver, /club_refresh_customer_access_projection/);
});

test("revoked or inactive staff do not receive staff-only access and member entitlements remain in the projection", () => {
  assert.match(migration, /staff\.active\s+and staff\.role in/);
  assert.match(migration, /staff\.role in \('owner','gym_admin','gym_staff','trainer'\)/);
  assert.match(migration, /club_memberships m[\s\S]*club_membership_holders h/);
  assert.match(migration, /club_entitlement_grants g[\s\S]*entitlement_key='gym_access'/);
  assert.match(migration, /club_product_entitlements pe[\s\S]*entitlement_key='gym_access'/);
  assert.doesNotMatch(migration, /insert into public\.club_memberships|delete from public\.club_memberships|update public\.club_memberships/);
});

test("Aimee receives her existing trainer, Coach and venue grant through standard provisioning", () => {
  assert.match(migration, /insert into public\.coach_permissions\(organisation_id,user_id,granted_by,active\)[\s\S]*g\.coach_requested/);
  assert.match(migration, /insert into public\.club_staff_location_access[\s\S]*unnest\(g\.location_ids\)/);
  assert.match(migration, /club_capabilities_for_role\(g\.intended_role\)/);
  assert.match(migration, /update public\.club_staff_access_grants set status='accepted'/);
});
