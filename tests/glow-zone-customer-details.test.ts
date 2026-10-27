import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { glowCustomerIsUnder18, glowCustomerMissingFields, validGlowDateOfBirth, validGlowPhone } from "../lib/glow-zone-customer-details";

const migration = readFileSync("supabase/migrations/2027-01-23-glow-customer-details-and-age-safety.sql", "utf8");
const account = readFileSync("app/account/page.tsx", "utf8");
const details = readFileSync("components/glow-zone-customer-details.tsx", "utf8");
const actions = readFileSync("app/glow-zone/actions.ts", "utf8");
const staff = readFileSync("components/club-sunbed-operations.tsx", "utf8");
const scanner = readFileSync("components/glow-zone-reception-scanner.tsx", "utf8");
const usePage = readFileSync("app/glow-zone/use/page.tsx", "utf8");

test("Glow registration requires names, mobile and a valid past DOB", () => {
  assert.equal(validGlowPhone("+44 7700 900123"), true);
  assert.equal(validGlowPhone("abc"), false);
  assert.equal(validGlowDateOfBirth("2000-02-29", new Date("2026-10-27T12:00:00Z")), true);
  assert.equal(validGlowDateOfBirth("2001-02-29", new Date("2026-10-27T12:00:00Z")), false);
  assert.deepEqual(glowCustomerMissingFields({ firstName: "", lastName: "Person", email: "person@example.test", phone: "bad", dateOfBirth: "" }), ["firstName", "phone", "dateOfBirth"]);
  for (const contract of [/Mobile phone<input required type="tel"/, /Date of birth<input required type="date"/, /phone: phone\.trim\(\)/, /date_of_birth: dateOfBirth/]) assert.match(account, contract);
});

test("declared DOB blocks under-18 use without becoming staff verification", () => {
  const today = new Date("2026-10-27T12:00:00Z");
  assert.equal(glowCustomerIsUnder18("2008-10-28", today), true);
  assert.equal(glowCustomerIsUnder18("2008-10-27", today), false);
  assert.match(migration, /c\.date_of_birth > \(current_date-interval '18 years'\)::date then 'under_18'/);
  assert.match(migration, /Declared under-18 restriction cannot be overridden/);
  assert.match(migration, /v_declared is not null and v_declared<>p_date_of_birth/);
  assert.match(usePage, /context\.declaredUnder18/);
  assert.match(usePage, /Reception cannot override an under-18 restriction/);
});

test("verified login fills only missing customer fields and creates no membership or entitlement", () => {
  assert.match(migration, /email_confirmed_at/);
  assert.match(migration, /first_name=coalesce\(nullif\(btrim\(first_name\),''\),v_first\)/);
  assert.match(migration, /phone=case when length\(btrim\(coalesce\(phone,''\)\)\)/);
  assert.match(migration, /date_of_birth=case when date_of_birth between '1900-01-01'/);
  assert.match(migration, /lower\(btrim\(email\)\)=v_email/);
  assert.doesNotMatch(migration, /insert into public\.(club_members|club_memberships|club_entitlement_grants|club_service_credit_lots)/i);
  assert.match(actions, /club_glow_complete_customer_details/);
  assert.doesNotMatch(details, /Finish setting up Glow Zone|Set up Glow Zone/);
});

test("existing users see only missing fields while retaining dashboard routing", () => {
  assert.match(details, /missing\.includes\(key\)/);
  assert.match(details, /Your existing R12 and Glow Zone information will be preserved/);
  assert.match(details, /window\.location\.reload\(\)/);
  assert.match(readFileSync("app/glow-zone/page.tsx", "utf8"), /GlowZoneCustomerView[\s\S]*missingDetails/);
  assert.match(readFileSync("components/glow-zone-account-setup.tsx", "utf8"), /window\.location\.replace\("\/glow-zone"\)/);
});

test("authorised staff can inspect details but verification remains capability and UUID scoped", () => {
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'induction\.perform'\)/);
  assert.match(migration, /organisation_id=p_organisation_id and user_id=p_user_id/);
  assert.match(migration, /'customer_phone',c\.phone,'declared_date_of_birth',c\.date_of_birth/);
  assert.match(staff, /Search name, email or phone/);
  assert.match(staff, /Staff verification cannot override the declared under-18 restriction/);
  assert.match(scanner, /Under 18 — sunbed use prohibited/);
});

test("session safety keeps exact duration, approval and effective adult checks", () => {
  assert.match(migration, /p_duration_minutes not between 1 and 15/);
  assert.match(migration, /club_glow_effective_age_status\(p_organisation_id,p_user_id\)='verified'/);
  assert.match(migration, /Glow Zone age verification required/);
  const original = readFileSync("supabase/migrations/2026-10-25-glow-zone-session-requests.sql", "utf8");
  assert.match(original, /club_location_authorized\(p_organisation_id,p_location_id\)/);
  assert.match(original, /Confirm the requested bed and duration exactly/);
});

test("the forward migration is ordered after the deployed deletion executor", () => {
  const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
  assert.ok(manifest.indexOf("2027-01-23-glow-customer-details-and-age-safety.sql") > manifest.indexOf("2027-01-22-account-deletion-executor.sql"));
});
