import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/2026-11-18-member-acquisition-onboarding.sql");
const joinPage = read("app/join/[clubSlug]/page.tsx");
const joinEntry = read("app/join/page.tsx");
const form = read("components/club-joining-form.tsx");
const actions = read("app/club/join/actions.ts");
const claimPage = read("app/member-hub/link/page.tsx");
const claim = read("components/club-member-claim.tsx");
const staffAction = read("app/club/members/actions.ts");
const staffLink = read("components/club-customer-link.tsx");
const account = read("app/account/page.tsx");
const reset = read("app/account/reset/page.tsx");
const memberHub = read("components/member-hub.tsx");

test("new members choose live venues and products before starting a durable join", () => {
  assert.match(joinPage, /club_list_joinable_memberships/);
  assert.match(joinPage, /club_list_join_locations/);
  assert.match(form, /name="locationId"/);
  assert.match(form, /name="productId"/);
  assert.match(actions, /club_start_membership_joining/);
  assert.match(migration, /club_join_requests_one_open_per_user/);
});

test("account creation and verification return to the browser join flow", () => {
  assert.match(joinPage, /mode=signUp&next=/);
  assert.match(joinPage, /email_confirmed_at/);
  assert.match(account, /emailRedirectTo:[\s\S]*next=/);
  assert.match(account, /router\.replace\(next\)/);
});

test("launch member details and separate consents are persisted on the existing customer model", () => {
  for (const field of ["first_name", "last_name", "date_of_birth", "address_line_1", "postcode", "emergency_contact_name", "emergency_contact_phone", "marketing_consent"]) assert.match(migration, new RegExp(field));
  assert.match(form, /name="termsAccepted"/);
  assert.match(form, /name="privacyAccepted"/);
  assert.match(form, /name="marketingConsent"/);
  assert.doesNotMatch(migration, /medical|diagnosis|condition/i);
});

test("verified-email claim links exactly one imported member without creating a membership", () => {
  assert.match(migration, /email_confirmed_at/);
  assert.match(migration, /if v_count<>1 then raise exception 'Member record is missing or ambiguous'/);
  assert.match(migration, /Member record does not match this account/);
  const claimFunction = migration.slice(migration.indexOf("club_claim_existing_member"), migration.indexOf("club_staff_link_member_account"));
  assert.doesNotMatch(claimFunction, /insert into public\.club_memberships/);
  assert.match(claimFunction, /update public\.club_membership_holders set user_id=auth\.uid\(\),customer_id=null/);
  assert.match(claim, /Yes, this is my membership/);
});

test("existing R12 and staff identities are preserved when member records are linked", () => {
  assert.match(migration, /on conflict\(organisation_id,user_id\) do update set active=true/);
  assert.doesNotMatch(migration, /on conflict\(organisation_id,user_id\) do update set role='member'/);
  assert.match(claimPage, /club_preview_existing_member_claim/);
  assert.doesNotMatch(migration, /insert into auth\.users/i);
  assert.doesNotMatch(migration, /coach_permissions/);
});

test("staff-assisted linking requires capability, verified target email and attributable evidence", () => {
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'members\.link_account'\)/);
  assert.match(migration, /email_confirmed_at is not null/);
  assert.match(migration, /p_verification_method not in \('photo_id','membership_reference','in_person'\)/);
  assert.match(migration, /'member\.account_staff_linked'/);
  assert.match(migration, /values\(p_organisation_id,auth\.uid\(\),actor_role/);
  assert.match(staffAction, /club_staff_link_member_account/);
  assert.match(staffLink, /I have verified this is the member’s own R12 account/);
  assert.doesNotMatch(staffLink, /Choose an active organisation account/);
});

test("payment handoff states never activate a paid membership", () => {
  for (const state of ["payment_required", "payment_pending", "payment_failed", "retry_required", "active"]) assert.match(migration, new RegExp(`'${state}'`));
  assert.match(migration, /v_product\.price_minor=0 then 'ready_to_activate'/);
  assert.match(migration, /club_activate_no_payment_join/);
  assert.match(migration, /price_minor=0 and sellable/);
  assert.match(form, /Opening this step has not activated membership or gym access/);
  assert.match(form, /Fix payment/);
  assert.match(actions, /Online payment setup is not available yet/);
});

test("abandoned joins resume server-side and retries remain idempotent", () => {
  assert.match(migration, /club_get_my_join_state/);
  assert.match(joinPage, /club_get_my_join_state/);
  assert.match(migration, /status not in \('completed','cancelled'\) for update/);
  assert.match(migration, /assignment_idempotency_key='join:'\|\|r\.id/);
  assert.match(migration, /on conflict\(organisation_id,idempotency_key\) do nothing/);
});

test("induction and access remain authoritative after join", () => {
  assert.match(memberHub, /Induction/);
  assert.match(memberHub, /inductionState\?\.required/);
  assert.match(form, /membership and access eligibility now follow Madhouse membership and induction policy/);
  assert.doesNotMatch(migration, /door|credential/i);
});

test("password recovery stays personal and browser completion does not require a native app", () => {
  assert.match(account, /Forgot password\?/);
  assert.match(account, /resetPasswordForEmail/);
  assert.match(reset, /auth\.updateUser\(\{ password \}\)/);
  assert.doesNotMatch(staffAction, /password/i);
  assert.match(form, /You can continue in this browser/);
  assert.match(form, /Open R12/);
  assert.match(form, /Home Screen/);
});

test("entry points and notification intents use member-friendly, provider-neutral boundaries", () => {
  assert.match(joinEntry, /Join \{org\.name\}/);
  assert.match(joinEntry, /I’m already a member/);
  assert.match(joinEntry, />Sign in</);
  assert.match(migration, /club_member_notification_intents/);
  assert.match(migration, /'member_service','billing'/);
  assert.doesNotMatch(migration, /members@r12\.live|madhouse\.accounts@r12\.live|smtp/i);
});

test("all member acquisition mutations remain organisation and authenticated-user scoped", () => {
  assert.match(migration, /organisation_id=p_organisation_id and user_id=v_user/);
  assert.match(migration, /where id=p_request_id and user_id=auth\.uid\(\)/);
  assert.match(migration, /id=p_customer_id and organisation_id=p_organisation_id/);
  assert.match(migration, /revoke all on function public\.club_claim_existing_member/);
  assert.match(migration, /grant execute on function public\.club_claim_existing_member[\s\S]*to authenticated/);
});
