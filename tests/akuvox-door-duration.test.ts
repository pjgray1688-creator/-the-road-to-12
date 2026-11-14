import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-11-14-rotherham-door-duration-request.sql", "utf8");
const api = readFileSync("app/api/club/access-devices/route.ts", "utf8");
const ui = readFileSync("components/club-akuvox-device-admin.tsx", "utf8");
const accessDecision = readFileSync("supabase/migrations/2026-12-04-member-pin-qr-access-pass.sql", "utf8");
const localWindowSource = readFileSync("supabase/migrations/2027-01-24-madhouse-membership-services-catalogue.sql", "utf8");

test("duration request is Rotherham-scoped, owner/admin-only, audited, and range-limited", () => {
  assert.match(migration, /requested_seconds between 3 and 10/);
  assert.match(migration, /auth\.uid\(\) is null or not public\.club_has_active_role\(p_organisation_id,array\['owner','gym_admin'\]\)/);
  assert.match(migration, /o\.slug='madhouse-gym'/);
  assert.match(migration, /lower\(btrim\(l\.name\)\)='rotherham'/);
  assert.match(migration, /Exactly one active Madhouse Rotherham location is required/);
  assert.match(migration, /access\.door_duration_requested/);
  assert.match(migration, /access\.door_duration_hardware_readback/);
  assert.match(migration, /revoke all on function[\s\S]*from public,anon,service_role/);
  assert.match(migration, /grant execute on function[\s\S]*to authenticated/);
  assert.doesNotMatch(migration, /update\s+public\.club_locations\s+set\s+access_mode/i);
});

test("R12 saves only a requested duration; manual hardware confirmation must match it", () => {
  assert.match(migration, /hardware_readback_seconds=requested_seconds/);
  assert.match(migration, /current_seconds<>p_observed_seconds/);
  assert.match(migration, /verification_method','manual_device_readback/);
  assert.match(migration, /hardware_changed',false/);
  assert.match(ui, /Saving here stores the R12 request only and does not change the physical relay/);
  assert.match(ui, /R12 cannot query the relay/);
  assert.match(ui, /Not synchronized/);
  assert.match(ui, /Record matching A02S read-back/);
  assert.match(api, /club_set_rotherham_door_duration_request/);
  assert.match(api, /club_confirm_rotherham_door_duration_readback/);
  assert.match(api, /body\.seconds < 3 \|\| body\.seconds > 10/);
});

test("device decision remains authoritative and check-in mode cannot unlock", () => {
  assert.match(accessDecision, /where id=p_device_id and status='active' and secret_hash=extensions\.digest\(p_secret,'sha256'\)/);
  assert.match(accessDecision, /return public\.club_access_decide_customer\(d\.organisation_id,d\.location_id,c,p_credential_type,'device',d\.id,p_nonce\)/);
  assert.match(accessDecision, /unlock_ok:=l\.access_mode='DOOR_CONTROLLED'/);
});

test("local source does not prove overnight Off-Peak access is enforced in Production", () => {
  assert.match(localWindowSource, /access_timezone='Europe\/London'/);
  assert.match(localWindowSource, /array\[1,2,3,4,5\],'10:00'::time,'15:00'::time/);
  assert.match(localWindowSource, /access_opens_at<access_closes_at/);
  assert.match(localWindowSource, /SUPERSEDED FOR PRODUCTION/);
});
