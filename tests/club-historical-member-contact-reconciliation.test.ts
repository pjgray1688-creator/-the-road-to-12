import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { normalizeMemberRow } from "@/lib/club-member-import";

const migration = readFileSync("supabase/migrations/2027-02-01-club-historical-member-contact-reconciliation.sql", "utf8");
const membersPage = readFileSync("app/club/members/page.tsx", "utf8");
const importNormaliser = readFileSync("lib/club-member-import.ts", "utf8");
const importRpc = readFileSync("supabase/migrations/2027-01-25-family-shared-memberships-and-billing.sql", "utf8");

test("historical repair reads legacy mobile and future imports emit the RPC's phone key", () => {
  assert.match(importNormaliser, /\{ phone \}/);
  const normalized = normalizeMemberRow({ full_name: "Example Member", mobile: "+44 (0)7700 900123" });
  assert.equal(normalized.phone, "+4407700900123");
  assert.equal("mobile" in normalized, false);
  assert.match(importRpc, /normalized_values->>'phone'/);
  assert.match(migration, /normalized_values \? 'mobile'[\s\S]*normalized_values->>'mobile'/);
  assert.match(migration, /normalized_values \? 'phone'[\s\S]*normalized_values->>'phone'/);
  assert.doesNotMatch(migration, /club_execute_member_import_batch|insert into public\.club_memberships|club_entitlement_grants|club_access_credentials/i);
});

test("contact reconciliation uses exact imported customer links and only fills blank unlinked contacts", () => {
  assert.match(migration, /c\.id=r\.imported_customer_id and c\.organisation_id=r\.organisation_id/);
  assert.match(migration, /c\.user_id is null/);
  assert.match(migration, /email_was_blank and x\.candidate_email is not null/);
  assert.match(migration, /phone_was_blank and x\.candidate_phone is not null/);
  assert.match(migration, /other_customer\.organisation_id=c\.organisation_id/);
  assert.match(migration, /other_customer\.id<>c\.id/);
  assert.match(migration, /i\.source_member_reference=/);
  assert.match(migration, /i\.customer_id=r\.imported_customer_id/);
});

test("staged blank contact fields remain blank and ambiguous shared emails are skipped", () => {
  assert.match(migration, /case when r\.normalized_values \? 'email'[\s\S]*then nullif\(lower\(btrim\(r\.normalized_values->>'email'\)\),''\)/);
  assert.match(migration, /count\(\*\) filter\(where candidate_email is not null\)[\s\S]*as email_candidate_count/);
  assert.match(migration, /x\.email_candidate_count=1/);
  assert.match(migration, /min\(source_email\) ~ '\^\[\^\[:space:\]@\]/);
});

test("repair migration is transaction-wrapped and does not mutate identity, membership, billing, or access", () => {
  assert.match(migration, /^--[\s\S]*?\bbegin;/);
  assert.match(migration, /commit;\s*$/);
  assert.match(migration, /update public\.club_customers[\s\S]*set email=[\s\S]*phone=[\s\S]*updated_at=now\(\)/);
  assert.doesNotMatch(migration, /update public\.(club_memberships|club_membership_holders|club_entitlement_grants|club_member_import_identities|profiles|auth\.users)|insert into public\.(club_memberships|club_entitlement_grants|club_access_credentials|club_payments)/i);
});

test("Members directory falls back to permission-scoped stored customer contacts", () => {
  assert.match(membersPage, /typeof row\.email === "string" && row\.email\.trim\(\).*customer\?\.email/s);
  assert.match(membersPage, /typeof row\.phone === "string" && row\.phone\.trim\(\).*customer\?\.phone/s);
  assert.match(membersPage, /listCustomers\(context\.organisation\.id\)/);
});

test("customer profiles show telephone and require members.view capability", () => {
  const profile = readFileSync("app/club/members/customer/[customerId]/page.tsx", "utf8");
  assert.match(profile, /hasCapability\(context\.organisation\.id, user\.id, "members\.view"\)/);
  assert.match(profile, /customer\.phone \? `Telephone: \$\{customer\.phone\}` : "No telephone recorded"/);
});
