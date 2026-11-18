import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { stageMemberCsv } from "../lib/club-member-import";

const read = (path: string) => readFileSync(path, "utf8");

test("household members with distinct legacy references retain one shared email as separate import rows", () => {
  const result = stageMemberCsv([
    "legacy_member_reference,full_name,email,phone",
    "MH-1001,Alex Household,household@example.test,07123456780",
    "MH-1002,Jamie Household,household@example.test,07123456781",
  ].join("\n"));

  assert.deepEqual(result.rows.map(row => row.blockers), [[], []]);
  assert.deepEqual(result.rows.map(row => row.normalized.legacyReference), ["MH-1001", "MH-1002"]);
  assert.equal(result.rows[0].normalized.email, result.rows[1].normalized.email);
});

test("shared household email without legacy references uses individual name and phone evidence", () => {
  const result = stageMemberCsv([
    "full_name,email,phone",
    "Alex Household,household@example.test,07123456780",
    "Jamie Household,household@example.test,07123456781",
  ].join("\n"));

  assert.deepEqual(result.rows.map(row => row.blockers), [[], []]);
});

test("shared contact email alone is never treated as proof that two rows are one person", () => {
  const result = stageMemberCsv([
    "email",
    "household@example.test",
    "household@example.test",
  ].join("\n"));

  assert.deepEqual(result.rows.map(row => row.blockers), [[], []]);
});

test("genuine duplicate identities remain blocked by repeated legacy reference or exact person evidence", () => {
  const sameReference = stageMemberCsv([
    "legacy_member_reference,full_name,email,phone",
    "MH-1001,Alex Household,household@example.test,07123456780",
    "MH-1001,Alex Household,household@example.test,07123456780",
  ].join("\n"));
  assert.match(sameReference.rows[1].blockers.join(" "), /Duplicate source person/);

  const samePerson = stageMemberCsv([
    "full_name,email,phone",
    "Alex Household,household@example.test,07123456780",
    " Alex   Household , HOUSEHOLD@example.test , 07123456780 ",
  ].join("\n"));
  assert.match(samePerson.rows[1].blockers.join(" "), /Duplicate source person/);
});

test("shared-email import rows remain unclaimed and the verified-email claim path refuses ambiguity", () => {
  const importMigration = read("supabase/migrations/2027-01-20-club-member-import-shared-email-identities.sql");
  const claimMigration = read("supabase/migrations/2026-11-19-club-auto-link-verified-imported-members.sql");

  assert.match(importMigration, /if v_customer is null and norm->>'email' is not null and v_email_rows=1 then/);
  assert.match(importMigration, /matched_user_id=case when v_email_rows=1 then v_user else null end/);
  assert.match(importMigration, /linked\.organisation_id=p_organisation_id and linked\.user_id=v_user/);
  assert.match(importMigration, /R12 account is already linked to another member profile/);
  assert.doesNotMatch(importMigration, /Duplicate email in this batch/);
  assert.match(claimMigration, /if v_count<>1 then raise exception 'Member record is missing or ambiguous'/);
  assert.match(claimMigration, /if v_rows>1 then return true/);
  assert.match(claimMigration, /if v_count<>1 then return jsonb_build_object\('state','ambiguous'\)/);
  assert.match(claimMigration, /and user_id is null/);
  assert.match(claimMigration, /perform public\.club_claim_existing_member\(v_org\.id,v_customer\.id\)/);
});
