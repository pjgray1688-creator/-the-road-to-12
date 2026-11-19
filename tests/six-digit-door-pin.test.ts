import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2027-02-08-club-six-digit-door-access-pins.sql", "utf8");
const credentialBase = readFileSync("supabase/migrations/2026-12-04-member-pin-qr-access-pass.sql", "utf8");
const gateway = readFileSync("gateway/akuvox-a02/gateway.ts", "utf8");
const api = readFileSync("app/api/club/access/decision/route.ts", "utf8");
const consoleUi = readFileSync("components/club-access-console.tsx", "utf8");
const memberPass = readFileSync("components/member-access-pass.tsx", "utf8");
const staffControls = readFileSync("components/club-access-pin-controls.tsx", "utf8");

test("new PINs are unbiased cryptographic six-digit values and collision retries are bounded", () => {
  assert.match(migration, /extensions\.gen_random_bytes\(4\)/);
  assert.match(migration, /candidate>=4294000000/);
  assert.match(migration, /candidate%1000000/);
  assert.match(migration, /lpad\([\s\S]*?,6,'0'\)/);
  assert.match(migration, /attempts>256/);
  assert.match(credentialBase, /club_access_person_token_uq/);
  assert.match(credentialBase, /club_access_one_permanent_type_uq/);
  assert.match(migration, /exception when unique_violation then[\s\S]*?select \* into pin_row/);
});

test("PIN hash rejects every format except six ASCII digits while QR hashing stays intact", () => {
  assert.match(migration, /p_value !~ '\^\[0-9\]\{6\}\$' then return null/);
  assert.match(migration, /p_type in \('pin','qr','wallet','nfc'\)[\s\S]*?extensions\.hmac/);
  assert.match(migration, /create or replace function public\.club_access_credential_hash/);
  assert.match(api, /!\/\^\\d\{6\}\$\//);
  assert.match(gateway, /PIN_PATTERN = \/\^\\d\{6\}\$\//);
});

test("issuance requires the existing tenant-scoped access projection and a verified linked identity", () => {
  assert.match(migration, /customer\.user_id is null[\s\S]*?return jsonb_build_object\('pin',null/);
  assert.match(migration, /auth\.users u[\s\S]*?u\.id=customer\.user_id[\s\S]*?email_confirmed_at is not null or u\.phone_confirmed_at is not null/);
  assert.match(migration, /club_refresh_customer_access_projection\(p_organisation_id,p_customer_id\)/);
  assert.match(migration, /projection\.access_allowed/);
  assert.match(migration, /projection\.valid_until<=now\(\)/);
  assert.match(migration, /where id=p_customer_id and organisation_id=p_organisation_id/);
  assert.match(migration, /where organisation_id=p_organisation_id and user_id=auth\.uid\(\)/);
  assert.match(migration, /grant execute on function public\.club_get_my_access_pass\(uuid\) to authenticated/);
  assert.match(migration, /extensions\.pgp_sym_encrypt\(pin,encode\(k,'hex'\),'cipher-algo=aes256'\)/);
  assert.match(migration, /credential_hash,secret_ciphertext/);
  assert.match(migration, /revoke all on function public\.club_access_credential_hash\(text,text\),[\s\S]*from public,anon,authenticated/);
});

test("existing eight-digit PINs are deliberately revoked and eligible verified holders alone are reissued", () => {
  assert.match(migration, /extensions\.pgp_sym_decrypt\(c\.secret_ciphertext[\s\S]*?\^\[0-9\]\{6\}\(\[0-9\]\{2\}\)\?\$/);
  assert.match(migration, /pin_length=8/);
  assert.match(migration, /set status='revoked',revoked_at=now\(\)[\s\S]*?pin_length=8/);
  assert.match(migration, /reissued_from=r\.old_credential_id/);
  assert.match(migration, /check \(credential_type<>'pin' or status<>'active' or \(pin_length is not null and pin_length=6\)\)/);
  assert.match(migration, /where credential_type='pin'[\s\S]*?status='active' and pin_length is distinct from 6/);
});

test("PIN presentation and reception controls use six digits; QR pass rendering remains independent", () => {
  assert.match(consoleUi, /maxLength=\{credentialType === "pin" \? 6 : 256\}/);
  assert.match(consoleUi, /credentialType === "pin" && !\/\^\\d\{6\}\$\//);
  assert.match(memberPass, /pass\.accessAllowed && \/\^\\d\{6\}\$\//);
  assert.match(memberPass, /accessQrMatrix\(pass\.qrToken\)/);
  assert.match(staffControls, /••••••/);
  assert.doesNotMatch(staffControls, /••••••••/);
});

test("shared-station PIN authentication remains separate from gym door credentials", () => {
  const station = readFileSync("supabase/migrations/2026-12-28-club-shared-station-pin-auth.sql", "utf8");
  assert.match(station, /club_station_verify_pin/);
  assert.doesNotMatch(migration, /club_station_staff_pins|club_station_verify_pin/);
});
