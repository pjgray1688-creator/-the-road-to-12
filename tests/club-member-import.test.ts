import assert from "node:assert/strict";
import test from "node:test";
import { parseMemberCsv, stageMemberCsv } from "@/lib/club-member-import";

test("ClubManager staging preserves quoted source fields and unknown columns", () => {
  const result = stageMemberCsv('Member ID,Full Name,Email,Unknown\n42,"Gray, Peter", PETER@EXAMPLE.COM,keep me\n');
  assert.deepEqual(result.rows[0].raw, { "member id": "42", "full name": "Gray, Peter", email: "PETER@EXAMPLE.COM", unknown: "keep me" });
  assert.equal(result.rows[0].normalized.email, "peter@example.com");
  assert.equal(result.rows[0].normalized.legacyReference, "42");
  assert.deepEqual(result.rows[0].warnings, ["Phone is missing", "Membership package is missing"]);
});

test("staging blocks duplicate people and ambiguous dates without inventing membership history", () => {
  const result = stageMemberCsv("email,full_name,start_date,membership_type\na@example.com,A Person,not-a-date,Unknown\na@example.com,A Person,2026-01-01,Unknown\n");
  assert.equal(result.rows[0].blockers.includes("Date format requires confirmation"), true);
  assert.equal(result.rows[1].blockers.includes("Duplicate source person in this batch"), true);
  const parsed = parseMemberCsv("name\nOnly Name\n");
  assert.equal(parsed.rows[0].fullName, "Only Name");
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
});
