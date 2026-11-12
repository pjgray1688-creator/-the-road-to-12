import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { glowCustomerMissingFields, validGlowPhone } from "../lib/glow-zone-customer-details";

const migration = readFileSync("supabase/migrations/2027-01-28-club-staff-data-access-expand.sql", "utf8") + "\n" + readFileSync("supabase/migrations/2027-01-29-club-staff-data-access-contract.sql", "utf8");
const account = readFileSync("app/account/page.tsx", "utf8");
const details = readFileSync("components/glow-zone-customer-details.tsx", "utf8");
const actions = readFileSync("app/glow-zone/actions.ts", "utf8");
const staff = readFileSync("components/club-sunbed-operations.tsx", "utf8");
const scanner = readFileSync("components/glow-zone-reception-scanner.tsx", "utf8");

test("Glow customer setup requests only identity and contact fields", () => {
  assert.equal(validGlowPhone("+44 7700 900123"), true);
  assert.equal(validGlowPhone("abc"), false);
  assert.deepEqual(glowCustomerMissingFields({ firstName: "", lastName: "Person", email: "person@example.test", phone: "bad" }), ["firstName", "phone"]);
  assert.match(account, /Mobile phone<input required type="tel"/);
  assert.doesNotMatch(account, /Date of birth<input|date_of_birth: dateOfBirth/);
  assert.match(migration, /insert into public\.club_customers\(organisation_id,user_id,display_name,email,phone,status,first_name,last_name\)/);
  assert.doesNotMatch(migration, /v_raw_dob|p_date_of_birth/);
  assert.match(actions, /club_glow_complete_customer_details_secure/);
  assert.doesNotMatch(details, /dateOfBirth|Date of birth/);
});

test("new adult verification stores outcome, actor and time without DOB and preserves legacy rows", () => {
  assert.match(migration, /values\(p_organisation_id,p_user_id,null,case when p_is_adult/);
  assert.match(migration, /on conflict\(organisation_id,user_id\) do update set status=excluded\.status,verified_at=excluded\.verified_at,verified_by=excluded\.verified_by/);
  assert.doesNotMatch(migration, /update public\.club_glow_age_verifications[\s\S]*?date_of_birth=null/);
  assert.match(migration, /club_glow_record_age_confirmation\(p_organisation_id uuid,p_user_id uuid,p_is_adult boolean/);
  assert.match(migration, /'status',r\.status,'verified_at',r\.verified_at,'verified_by',r\.verified_by/);
  assert.match(staff, /I checked acceptable ID and confirm this customer is 18 or over/);
  assert.match(scanner, /I checked acceptable ID and confirm this customer is 18 or over/);
  assert.doesNotMatch(staff + scanner, /Date of birth from ID|Declared DOB|p_date_of_birth/);
  assert.match(migration, /when c\.date_of_birth>\(current_date-interval '18 years'\)::date then 'under_18'/);
});

test("age confirmation and scan remain organisation/location guarded", () => {
  assert.match(migration, /club_glow_carlton_staff_allowed\(p_organisation_id\)/);
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'induction\.perform'\)/);
  assert.match(migration, /club_glow_effective_age_status\(p_organisation_id,r\.user_id\)/);
  assert.match(migration, /club_glow_carlton_staff_allowed\(p_organisation_id\) then raise exception 'Glow Zone reception permission required at Carlton'/);
});
