import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const polished = fs.readFileSync("supabase/migrations/2026-11-26-coach-invitation-email-polish.sql", "utf8");
const correction = fs.readFileSync("supabase/migrations/2026-12-29-pgcrypto-schema-qualified-functions.sql", "utf8");
const pgcryptoFunctions = "digest|hmac|gen_random_bytes|crypt|gen_salt|pgp_sym_encrypt|pgp_sym_decrypt";
const unqualifiedCall = new RegExp(`(?<![\\w.])(?:${pgcryptoFunctions})\\s*\\(`, "i");

test("Coach invitation/referral effective definitions qualify pgcrypto in extensions", () => {
  assert.doesNotMatch(polished, unqualifiedCall);
  for (const name of ["coach_create_referral_invite", "coach_resend_referral_invite", "coach_preview_referral"]) {
    const start = polished.indexOf(`create or replace function public.${name}(`);
    assert.notEqual(start, -1, `${name} remains defined by the 11-26 migration`);
    const end = polished.indexOf("$$;", start);
    assert.notEqual(end, -1);
    assert.match(polished.slice(start, end), /extensions\.(?:digest|gen_random_bytes)\s*\(/);
  }
  assert.match(correction, /create or replace function public\.coach_claim_referral/);
  assert.match(correction, /extensions\.digest\(btrim\(p_token\),'sha256'\)/);
});

test("member access/import effective corrections qualify pgcrypto and preserve narrow definer paths", () => {
  for (const name of ["club_execute_member_import_batch", "club_reception_access_decision"]) {
    const start = correction.indexOf(`create or replace function public.${name}(`);
    assert.notEqual(start, -1, `${name} must be replaced forward-only`);
    const end = correction.indexOf("$$;", start);
    assert.notEqual(end, -1);
    const definition = correction.slice(start, end);
    assert.doesNotMatch(definition, unqualifiedCall, `${name} has no unqualified pgcrypto references`);
    assert.match(definition, /security definer set search_path=pg_catalog,public/i);
    assert.match(definition, /extensions\.digest\s*\(/);
  }
  const coachClaim = correction.slice(correction.indexOf("create or replace function public.coach_claim_referral"), correction.indexOf("create or replace function public.club_execute_member_import_batch"));
  assert.doesNotMatch(coachClaim, unqualifiedCall);
  assert.match(coachClaim, /security definer set search_path=pg_catalog,public/i);
});

test("corrections preserve authenticated-only execution grants", () => {
  assert.match(polished, /revoke all on function public\.coach_create_referral_invite\(text,text\),public\.coach_resend_referral_invite\(uuid\),public\.coach_preview_referral\(text\) from public,anon/);
  assert.match(polished, /grant execute on function public\.coach_create_referral_invite\(text,text\),public\.coach_resend_referral_invite\(uuid\) to authenticated/);
  assert.match(correction, /revoke all on function public\.coach_claim_referral\(text\),public\.club_execute_member_import_batch\(uuid,uuid\),public\.club_reception_access_decision\(uuid,uuid,text,text\) from public,anon,authenticated/);
  assert.match(correction, /grant execute on function public\.coach_claim_referral\(text\),public\.club_execute_member_import_batch\(uuid,uuid\),public\.club_reception_access_decision\(uuid,uuid,text,text\) to authenticated/);
});
