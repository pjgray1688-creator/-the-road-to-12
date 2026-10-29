import assert from "node:assert/strict";
import test from "node:test";
import { parseMemberCsv, stageMemberCsv } from "@/lib/club-member-import";

test("ClubManager staging preserves quoted source fields and unknown columns", () => {
  const result = stageMemberCsv('Member ID,Full Name,Email,Unknown\n42,"Gray, Peter", PETER@EXAMPLE.COM,keep me\n');
  assert.deepEqual(result.rows[0].raw, { "member id": "42", "full name": "Gray, Peter", email: "PETER@EXAMPLE.COM", unknown: "keep me" });
  assert.equal(result.rows[0].normalized.email, "peter@example.com");
  assert.equal(result.rows[0].normalized.legacyReference, "42");
  assert.deepEqual(result.rows[0].warnings, ["Phone is missing", "Membership package is missing; no membership will be created"]);
});

test("staging blocks duplicate people and ambiguous dates without inventing membership history", () => {
  const result = stageMemberCsv("email,full_name,start_date,membership_type\na@example.com,A Person,not-a-date,Unknown\na@example.com,A Person,2026-01-01,Unknown\n");
  assert.equal(result.rows[0].blockers.includes("Date format requires confirmation"), true);
  assert.equal(result.rows[1].blockers.includes("Duplicate source person in this batch"), true);
  const parsed = parseMemberCsv("name\nOnly Name\n");
  assert.equal(parsed.rows[0].fullName, "Only Name");
});

test("shared contract staging preserves payer, roles and provider evidence without treating it as payment", () => {
  const result = stageMemberCsv("legacy_member_reference,full_name,membership_type,shared_contract_id,covered_person_role,responsible_payer_member_id,recurring_amount,next_payment_date,paid_through_date,billing_method,mandate_reference\nA1,Adult One,Family Membership,FAM-7,adult,A1,45.00,2026-12-01,2026-11-30,GoCardless,MD123\nC1,Child One,Family Membership,FAM-7,child,A1,45.00,2026-12-01,2026-11-30,GoCardless,MD123\n");
  assert.equal(result.rows.every(row => row.blockers.length === 0), true);
  assert.deepEqual(result.rows.map(row => row.normalized.householdRole), ["adult", "child"]);
  assert.equal(result.rows[0].normalized.responsiblePayerReference, "A1");
  assert.equal(result.rows[0].normalized.providerSubscriptionReference, "MD123");
  assert.match(result.rows[0].warnings.join(" "), /reconciliation only/);
});

test("import migration is staged, owner-capability protected and never fabricates providers or access", async () => {
  const source = await import("node:fs").then(fs => fs.readFileSync("supabase/migrations/2026-09-30-club-member-import.sql", "utf8"));
  assert.match(source, /members\.import/);
  assert.match(source, /raw_values jsonb/);
  assert.match(source, /source_member_reference/);
  assert.match(source, /club_customers/);
  assert.doesNotMatch(source, /insert into auth\.users/i);
  assert.doesNotMatch(source, /club_payments/);
  assert.match(source, /status not in \('ready','importing'\)/);
  assert.match(source, /club_revalidate_member_import_batch/);
  assert.match(source, /raw_values/);
  assert.match(source, /Duplicate source external ID/);
  assert.match(source, /membership package mapping required/i);
  assert.match(source, /blocking_count=v_blocking/);
  assert.match(source, /imported_member_id uuid references public\.club_members\(id\)/);
  assert.doesNotMatch(source, /references public\.club_members\(id,organisation_id\)/);
  assert.match(source, /date_values:=ARRAY\[/);
  assert.match(source, /foreach ident in ARRAY date_values loop/);
  assert.doesNotMatch(source, /foreach ident in array\[/);
});
