import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2027-01-31-rotherham-akuvox-device-admin.sql", "utf8");
const api = readFileSync("app/api/club/access-devices/route.ts", "utf8");
const locationsPage = readFileSync("app/club/locations/page.tsx", "utf8");
const ui = readFileSync("components/club-akuvox-device-admin.tsx", "utf8");
const deviceDecision = readFileSync("supabase/migrations/2026-12-04-member-pin-qr-access-pass.sql", "utf8");

test("Akuvox admin migration is transactional, guarded, and leaves existing access mode and member records untouched", () => {
  assert.match(migration, /^--[\s\S]*?\nbegin;/);
  assert.match(migration.trim(), /commit;$/);
  assert.match(migration, /Akuvox administration prerequisites are missing/);
  assert.match(migration, /table columns do not match the deployed contract/);
  assert.doesNotMatch(migration, /update\s+public\.(club_memberships|club_customers|club_access_credentials|club_locations)\b/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(club_access_decisions|club_audit_events)/i);
});

test("provisioning is active-owner/admin only and binds the device to the sole Madhouse Rotherham location", () => {
  const provision = migration.slice(migration.indexOf("create or replace function public.club_provision_rotherham_akuvox_device"), migration.indexOf("create or replace function public.club_list_rotherham_akuvox_devices"));
  assert.match(provision, /auth\.uid\(\) is null or not public\.club_has_active_role\(p_organisation_id,array\['owner','gym_admin'\]\)/);
  assert.match(provision, /o\.slug='madhouse-gym'/);
  assert.match(provision, /lower\(btrim\(l\.name\)\)='rotherham'/);
  assert.match(provision, /rotherham_count<>1/);
  assert.match(provision, /location_id=p_location_id/);
  assert.match(provision, /p_secret_hash bytea/);
  assert.match(provision, /octet_length\(p_secret_hash\)<>32/);
  assert.match(provision, /values\(p_device_id,p_organisation_id,p_location_id,btrim\(p_name\),p_secret_hash,'disabled',auth\.uid\(\)\)/);
  assert.match(provision, /actor_role,action,target_type,target_id,location_id,metadata/);
  assert.doesNotMatch(provision, /return jsonb_build_object\([^;]*(secret_hash|secret)/i);
});

test("management device list omits the hash and requires an active manager identity", () => {
  const list = migration.slice(migration.indexOf("create or replace function public.club_list_rotherham_akuvox_devices"), migration.indexOf("create or replace function public.club_set_rotherham_akuvox_device_status"));
  assert.match(list, /auth\.uid\(\) is null or not public\.club_has_active_role\(p_organisation_id,array\['owner','gym_admin'\]\)/);
  assert.match(list, /'accessMode',location_row\.access_mode/);
  assert.match(list, /'lastSeenAt',d\.last_seen_at/);
  assert.doesNotMatch(list, /secret_hash|secret_ciphertext|secretHash/i);
});

test("activation is check-in-only and revocation is organisation/location scoped and audited", () => {
  const status = migration.slice(migration.indexOf("create or replace function public.club_set_rotherham_akuvox_device_status"), migration.indexOf("revoke all on function public.club_provision_rotherham_akuvox_device"));
  assert.match(status, /auth\.uid\(\) is null or not public\.club_has_active_role\(p_organisation_id,array\['owner','gym_admin'\]\)/);
  assert.match(status, /dev\.organisation_id=p_organisation_id and dev\.location_id=rotherham_id/);
  assert.match(status, /location_mode<>'CHECKIN_ONLY'/);
  assert.match(status, /access\.device_revoked/);
  assert.match(status, /actor_user_id,actor_role,action,target_type,target_id,location_id,reason,metadata/);
  assert.match(status, /p_status is null or p_status not in \('active','disabled'\)/);
  assert.match(deviceDecision, /where id=p_device_id and status='active' and secret_hash=extensions\.digest\(p_secret,'sha256'\)/);
  assert.match(deviceDecision, /if not found then raise exception 'Device authentication failed'/);
});

test("all device administration RPCs deny anon/public/service-role execution and grant authenticated only", () => {
  for (const signature of [
    "club_provision_rotherham_akuvox_device(uuid,uuid,uuid,text,bytea)",
    "club_list_rotherham_akuvox_devices(uuid)",
    "club_set_rotherham_akuvox_device_status(uuid,uuid,text,text)",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${signature.replace(/[()]/g, "\\$&")} from public,anon,service_role`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${signature.replace(/[()]/g, "\\$&")} to authenticated`));
  }
});

test("server provisioning authenticates same-origin requests, hashes the one-time secret, and returns no-store", () => {
  assert.match(api, /request\.headers\.get\("origin"\)/);
  assert.match(api, /client\.auth\.getUser\(\)/);
  assert.match(api, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(api, /createHash\("sha256"\)\.update\(deviceSecret/);
  assert.match(api, /club_provision_rotherham_akuvox_device/);
  assert.match(api, /deviceSecret, status: "disabled"/);
  assert.match(api, /private, no-store/);
  assert.doesNotMatch(api, /console\.(log|info|error).*deviceSecret/);
});

test("UI is gated to owner/admin and hides secret after one-time display; server RPC remains authoritative", () => {
  assert.match(locationsPage, /context\.role === "owner" \|\| context\.role === "gym_admin"/);
  assert.match(locationsPage, /club_list_rotherham_akuvox_devices/);
  assert.match(ui, /Copy this one-time gateway secret now/);
  assert.match(ui, /setResult\(null\)/);
  assert.match(ui, /Revoke device/);
  assert.match(ui, /Enable for check-in test/);
  assert.match(ui, /accessMode === "CHECKIN_ONLY"/);
});
