import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const staffProjection = readFileSync("supabase/migrations/2026-11-07-staff-invitation-onboarding-and-gym-access.sql", "utf8");
const accessDecision = readFileSync("supabase/migrations/2026-12-13-member-age-induction-access-eligibility.sql", "utf8");
const attendance = readFileSync("supabase/migrations/2026-12-23-club-attendance-station-leaderboard.sql", "utf8");
const gateway = readFileSync("gateway/akuvox-a02/gateway.ts", "utf8");
const deviceAdmin = readFileSync("components/club-akuvox-device-admin.tsx", "utf8");

test("Madhouse staff access comes from active linked Club roles, not paid membership or home gym", () => {
  assert.match(staffProjection, /staff\.active\s+and\s+staff\.role in \('owner','gym_admin','gym_staff','trainer'\)/);
  assert.match(staffProjection, /'active_staff'::text,'locations'::text/);
  assert.match(staffProjection, /lower\(l\.name\) in \('rotherham','carlton'\)/);
  assert.match(staffProjection, /club_staff_member_access_projection_refresh/);
  assert.match(staffProjection, /after insert or update or delete on public\.club_members/);
  const policy = staffProjection.slice(staffProjection.indexOf("create or replace function public.club_refresh_customer_access_projection"), staffProjection.indexOf("create or replace function public.club_refresh_staff_customer_access_projection"));
  assert.doesNotMatch(policy, /preferred_location_id|home_location/);
  assert.match(policy, /selected\.source='active_staff'/);
});

test("live access uses the registered physical location, entitlement scope, current validity and safeguarding decision", () => {
  const functionBody = accessDecision.slice(accessDecision.indexOf("create or replace function public.club_access_decide_customer"));
  assert.match(functionBody, /where id=p_location_id and organisation_id=p_organisation_id/);
  assert.match(functionBody, /p\.valid_until<=now\(\)/);
  assert.match(functionBody, /p\.access_scope='locations'/);
  assert.match(functionBody, /club_access_safety_facts\(p_organisation_id,c\.id,p_location_id,now\(\)\)/);
  assert.match(functionBody, /unlock_ok:=l\.access_mode='DOOR_CONTROLLED'/);
});

test("successful live decisions feed the canonical attendance ledger once, with repeat-window deduplication", () => {
  assert.match(attendance, /unique,?\s*references public\.club_access_decisions\(id\)/);
  assert.match(attendance, /new\.decision='allow' and new\.attendance_recorded and new\.customer_id is not null/);
  assert.match(attendance, /on conflict\(access_decision_id\) do nothing/);
  assert.match(attendance, /select interval '2 hours'/);
  assert.match(accessDecision, /decided_at>now\(\)-interval '10 seconds'/);
  assert.match(accessDecision, /location_id=p_location_id/);
});

test("Akuvox backend failure is fail-closed and has no local offline authorization branch", () => {
  assert.match(gateway, /const DENY = JSON\.stringify\(\{ isvalid: false \}\)/);
  assert.match(gateway, /if \(!response\.ok\) return \{ status: 200, body: DENY \}/);
  assert.match(gateway, /catch \{[\s\S]*?return \{ status: 200, body: DENY \}/);
  assert.doesNotMatch(gateway, /offlineCache|offlineAuthorize|authorizeFromCache/);
  assert.doesNotMatch(gateway, /console\.(log|error|warn)/);
  assert.match(deviceAdmin, /If the gateway cannot reach R12, the request is denied; offline authorization is not configured/);
});
