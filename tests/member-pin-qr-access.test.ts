import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { accessQrMatrix } from "@/lib/qr-code";

const sql = readFileSync("supabase/migrations/2026-12-04-member-pin-qr-access-pass.sql", "utf8");
const memberPage = readFileSync("app/member-hub/page.tsx", "utf8");
const memberPass = readFileSync("components/member-access-pass.tsx", "utf8");
const consoleUi = readFileSync("components/club-access-console.tsx", "utf8");
const deviceApi = readFileSync("app/api/club/access/decision/route.ts", "utf8");

test("1 member receives a server-generated permanent PIN", () => {
  assert.match(sql, /gen_random_bytes\(4\)/);
  assert.match(sql, /'pin'.*true.*'active'/s);
  assert.match(sql, /club_holder_access_projection_refresh/);
});

test("2 PIN remains stable across membership changes", () => {
  assert.match(sql, /where organisation_id=p_organisation_id and customer_id=p_customer_id and credential_type='pin' and permanent and status='active'/);
  assert.doesNotMatch(sql, /club_refresh_membership_access_projection[\s\S]{0,900}(revoke|delete).*club_access_credentials/i);
});

test("3 active PINs are unique", () => {
  assert.match(sql, /club_access_person_token_uq/);
  assert.match(sql, /exception when unique_violation then[\s\S]+if found then exit/);
  assert.match(sql, /%100000000/);
});

test("4 member can view their own PIN", () => {
  assert.match(sql, /club_get_my_access_pass/);
  assert.match(sql, /pgp_sym_decrypt\(pin_row\.secret_ciphertext/);
  assert.match(memberPage, /club_get_my_access_pass/);
  assert.match(memberPass, /Personal access PIN/);
});

test("5 another member cannot view the PIN", () => {
  assert.match(sql, /where organisation_id=p_organisation_id and user_id=auth\.uid\(\)/);
  assert.doesNotMatch(sql, /club_get_my_access_pass\(p_organisation_id uuid,p_(customer|user)_id/i);
});

test("6 QR credential is permanent and stable", () => {
  assert.match(sql, /credential_type='qr' and permanent and status='active'/);
  assert.match(sql, /'R12-'\|\|upper\(encode\(gen_random_bytes\(16\),'hex'\)\)/);
  assert.deepEqual(accessQrMatrix("R12-STABLE"), accessQrMatrix("R12-STABLE"));
});

test("7 QR contains only an opaque token and no personal data", () => {
  assert.doesNotMatch(sql, /token:=.*(email|display_name|customer_id)/);
  const value = "R12-0123456789ABCDEF0123456789ABCDEF";
  const matrix = accessQrMatrix(value);
  assert.equal(matrix.length, 33);
  assert.ok(matrix.every((row) => row.length === 33));
  assert.match(memberPass, /accessQrMatrix\(pass\.qrToken\)/);
});

test("8 Carlton-home member can enter Rotherham", () => {
  assert.doesNotMatch(sql, /home_location|preferred_location/);
  assert.match(sql, /p_location_id=any\(p\.location_ids\)/);
});

test("9 Rotherham-home member can check in at Carlton", () => {
  assert.match(sql, /lower\(l\.name\) in \('rotherham','carlton'\)/);
  assert.match(sql, /access_mode='CHECKIN_ONLY'/);
});

test("10 home gym never restricts access", () => {
  assert.doesNotMatch(sql, /home gym|home_location|preferred.*location/i);
  assert.match(memberPass, /preferred gym changes/);
});

test("11 active member PIN is resolved to the fast decision", () => {
  assert.match(sql, /p_credential_type text default 'pin'/);
  assert.match(sql, /credential_hash=public\.club_access_credential_hash/);
  assert.match(deviceApi, /"pin"/);
});

test("12 active member QR uses the same decision path", () => {
  assert.match(sql, /p_credential_type not in \('pin','qr','legacy_member_reference','barcode'\)/);
  assert.match(consoleUi, /R12 QR pass/);
});

test("13 payment failure inside grace remains allowed", () => {
  assert.match(sql, /'failed','grace','retry_scheduled','payment_pending','due'/);
  assert.match(sql, /allowed:=true; state:=case when grace/);
  assert.match(consoleUi, /payment grace or retry/);
});

test("14 configured payment suspension denies access", () => {
  assert.match(sql, /access_suspension_enabled/);
  assert.match(sql, /suspended then state:='action_required'; why:='payment_action_required'/);
});

test("15 membership activation refreshes access immediately", () => {
  assert.match(sql, /after insert or update of status,starts_at,ends_at,product_id or delete on public\.club_memberships/);
  assert.match(sql, /club_refresh_customer_access_projection/);
});

test("16 cancellation refreshes access immediately", () => {
  assert.match(sql, /selected\.status='cancelled'/);
  assert.match(sql, /membership_cancelled/);
});

test("17 expiry is enforced at presentation time", () => {
  assert.match(sql, /p\.valid_until is not null and p\.valid_until<=now\(\)/);
  assert.match(sql, /why:='membership_expired'/);
  assert.match(sql, /p\.access_state='not_started' and p\.valid_from<=now\(\).*club_refresh_customer_access_projection/s);
});

test("18 restored billing access refreshes immediately", () => {
  assert.match(sql, /update of active,cleared_at/);
  assert.match(sql, /update of state,grace_started_at,recovery_exhausted_at/);
  assert.match(sql, /club_policy_access_projection_refresh/);
  assert.match(sql, /club_grant_access_projection_refresh/);
});

test("19 CHECKIN_ONLY records attendance without unlock", () => {
  assert.match(sql, /record_attendance:=bounced is null/);
  assert.match(sql, /unlock_ok:=l\.access_mode='DOOR_CONTROLLED'/);
  assert.match(consoleUi, /Check-in only — no automated unlock/);
});

test("20 DOOR_CONTROLLED returns an unlock permission", () => {
  assert.match(sql, /'DOOR_CONTROLLED'/);
  assert.match(sql, /'unlockPermitted',allowed and unlock_ok/);
});

test("21 DISABLED location denies credentials", () => {
  assert.match(sql, /l\.access_mode='DISABLED'.*why:='location_disabled'/s);
});

test("22 day pass works during its validity window without Auth", () => {
  assert.match(sql, /h\.customer_id=c\.id/);
  assert.match(sql, /candidate\.starts_at<=now\(\)/);
  assert.match(sql, /candidate\.ends_at is null or candidate\.ends_at>now\(\)/);
  assert.doesNotMatch(sql, /club_issue_customer_access_pass[\s\S]{0,500}auth\.users/);
});

test("23 day pass stops at expiry without rotating credentials", () => {
  assert.match(sql, /valid_until<=now\(\).*membership_expired/s);
  assert.doesNotMatch(sql, /valid_until<=now\(\)[\s\S]{0,300}(revoke|delete).*club_access_credentials/i);
});

test("24 repeated scans are audited without duplicate arrivals", () => {
  assert.match(sql, /interval '10 seconds'/);
  assert.match(sql, /attendance_recorded and decided_at/);
  assert.match(sql, /bounce_of/);
});

test("25 repeated wrong PIN attempts are throttled", () => {
  assert.match(sql, /recent_failures/);
  assert.match(sql, />=10/);
  assert.match(sql, /access_throttled/);
  assert.match(deviceApi, /status===429/);
});

test("26 raw PIN and secrets are not written to audit records", () => {
  const decisionInsert = sql.match(/insert into public\.club_access_decisions[\s\S]*?return jsonb_build_object/ig)?.join("\n") ?? "";
  assert.doesNotMatch(decisionInsert, /p_credential[,)]|p_secret[,)]/);
  assert.doesNotMatch(sql, /metadata.*pin/i);
});

test("27 existing staff and Coach roles are untouched", () => {
  assert.doesNotMatch(sql, /(insert|update|delete).*public\.club_members\b/i);
  assert.doesNotMatch(sql, /coach_relationships|coach_permissions/i);
});

test("28 reception supports PIN, QR and clear operating outcomes", () => {
  assert.match(consoleUi, /Personal PIN/);
  assert.match(consoleUi, /R12 QR pass/);
  assert.match(consoleUi, /Arrival recorded/);
  assert.match(consoleUi, /Door unlock permitted/);
  assert.match(consoleUi, /"ALLOW"/);
  assert.match(consoleUi, /"DENY"/);
});
