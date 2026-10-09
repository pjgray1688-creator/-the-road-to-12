import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/2026-12-13-member-age-induction-access-eligibility.sql", "utf8");
const accessUi = readFileSync("components/club-access-console.tsx", "utf8");
const memberPage = readFileSync("app/club/members/[userId]/page.tsx", "utf8");
const customerPage = readFileSync("app/club/members/customer/[customerId]/page.tsx", "utf8");
const inductionAction = readFileSync("app/club/induction/actions.ts", "utf8");
const inductionCompletion = readFileSync("components/club-member-induction-completion.tsx", "utf8");
const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");

test("age facts use recorded DOB and UK-local age boundaries without inferring missing DOB", () => {
  assert.match(migration, /c\.date_of_birth is not null/);
  assert.match(migration, /at time zone 'Europe\/London'/);
  assert.match(migration, /interval '18 years'/);
  assert.match(migration, /interval '16 years'/);
  assert.match(migration, /age_state text := 'missing_date_of_birth'/);
  assert.match(migration, /age_block := 'under_16_restricted'/);
  assert.match(migration, /age_block := 'under_18_restricted'/);
  assert.match(migration, /age_block := 'missing_date_of_birth'/);
  assert.match(migration, /date_of_birth_conflict/);
  assert.match(migration, /coalesce\(c\.date_of_birth,verified_dob\)/);
  assert.match(migration, /g\.status in \('verified','under_18'\)/);
});

test("PIN and QR decisions apply configured induction hold and grace consistently", () => {
  assert.match(migration, /overdue_access='hold'/);
  assert.match(migration, /p_at < induction_due/);
  assert.match(migration, /if anchor is null then[\s\S]+?select max\(m\.starts_at\)[\s\S]+?anchor := membership_anchor/);
  assert.match(migration, /appointment_extension_enabled/);
  assert.match(migration, /b\.policy_id=policy_row\.id and b\.status='booked'\s+order by b\.starts_at desc limit 1/);
  assert.match(migration, /booking_row\.starts_at>p_at and policy_row\.appointment_extension_enabled/);
  assert.match(migration, /safety:=public\.club_access_safety_facts/);
  assert.match(migration, /if safety->>'blocked'='true' then why:=safety->>'reason'/);
  assert.match(migration, /revoke all on function public\.club_access_decide_customer[^;]+from public,anon,authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function public\.club_access_decide_customer/i);
});

test("24-hour eligibility requires active projected access, a controlled location, adult age, and no induction hold", () => {
  assert.match(migration, /a\.access_allowed/);
  assert.match(migration, /access_mode='DOOR_CONTROLLED'/);
  assert.match(migration, /membership_valid and is_door_controlled and age_state='adult' and blocked_reason is null/);
  assert.match(migration, /access_scope <> 'locations'/);
});

test("reception and member profiles show age, induction and 24-hour outcomes in plain language", () => {
  assert.match(accessUi, /Under 16 — staff review required/);
  assert.match(accessUi, /Under 18 — 24-hour door access is not available/);
  assert.match(accessUi, /Induction:/);
  assert.match(accessUi, /24-hour access:/);
  assert.match(memberPage, /ACCESS/);
  assert.match(memberPage, /24-hour door access:/);
  assert.match(customerPage, /ACCESS ELIGIBILITY/);
});

test("family holder summaries remain organisation-scoped and reveal names only to member-view staff", () => {
  assert.match(migration, /club_get_membership_household/);
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.view'\)/);
  assert.match(migration, /c\.organisation_id=h\.organisation_id/);
  assert.match(memberPage, /ClubMembershipHousehold/);
  assert.match(customerPage, /Shared with/);
});

test("family holder changes are capability-checked, membership-locked, constrained, and audited", () => {
  assert.match(migration, /club_set_membership_household_member/);
  assert.match(migration, /'memberships\.assign'/);
  assert.match(migration, /where id=p_membership_id and organisation_id=p_organisation_id for update/i);
  assert.match(migration, /h\.organisation_id=p_organisation_id/);
  assert.match(migration, /holder_count<=1/);
  assert.match(migration, /recorded billing contact/);
  assert.match(migration, /club_membership_household_events/);
  assert.match(migration, /actor_user_id,action,reason/);
  assert.match(migration, /revoke all on public\.club_membership_household_events from public,anon,authenticated/i);
  assert.match(migration, /revoke all on function public\.club_set_membership_household_member[^;]+from public,anon/i);
  assert.match(migration, /grant execute on function public\.club_set_membership_household_member[^;]+to authenticated/i);
  assert.match(migration, /club_membership_holders\(id,membership_id,organisation_id,customer_id\)/);
  assert.match(migration, /club_membership_holders\(id,membership_id,organisation_id,user_id\)/);
  const householdUi = readFileSync("components/club-membership-household.tsx", "utf8");
  assert.match(householdUi, /Remove/);
  assert.match(householdUi, /Add to shared membership/);
  assert.match(householdUi, /holder\.billingContact \|\| holders\.length <= 1/);
});

test("staff can complete only an authorised booked induction through the existing audited RPC", () => {
  assert.match(migration, /'inductionBooking',case when booking_row\.id is null then null/);
  assert.match(migration, /inductionBooking',safety->'inductionBooking'/);
  assert.match(memberPage, /ClubMemberInductionCompletion/);
  assert.match(inductionAction, /["']induction\.perform["']/);
  assert.match(inductionAction, /club_reconcile_induction_booking/);
  assert.match(inductionAction, /p_status: "completed"/);
  assert.match(inductionCompletion, /Record induction complete/);
});

test("staff can record an in-person induction for an unlinked imported customer without fabricating Auth", () => {
  assert.match(migration, /add column if not exists customer_id uuid/);
  assert.match(migration, /alter column user_id drop not null/);
  assert.match(migration, /num_nonnulls\(user_id,customer_id\)=1/);
  assert.match(migration, /club_record_customer_induction_completion/);
  assert.match(migration, /club_location_authorized\(p_organisation_id,p_location_id\)/);
  assert.match(migration, /where id=p_customer_id and organisation_id=p_organisation_id for update/i);
  assert.match(migration, /case when c\.user_id is null then c\.id end/);
  assert.match(migration, /verified_by,completed_at/);
  assert.match(inductionAction, /club_record_customer_induction_completion/);
  assert.match(inductionCompletion, /Record completion/);
});

test("forward migration follows the applied membership lifecycle migration", () => {
  assert.ok(manifest.indexOf("2026-12-12-membership-access-lifecycle.sql") < manifest.indexOf("2026-12-13-member-age-induction-access-eligibility.sql"));
});
