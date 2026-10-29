import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { graceArrangementState, isGraceExtensionEligible } from "@/lib/club-payment-grace";
import { hasClubCapability } from "@/lib/club-capabilities";

const migration = readFileSync("supabase/migrations/2027-01-26-membership-payment-grace-extensions.sql", "utf8");
const action = readFileSync("app/club/members/actions.ts", "utf8");
const customerProfile = readFileSync("app/club/members/customer/[customerId]/page.tsx", "utf8");
const memberProfile = readFileSync("app/club/members/[userId]/page.tsx", "utf8");
const control = readFileSync("components/club-membership-grace-extension.tsx", "utf8");
const approvalFunction = migration.slice(migration.indexOf("create or replace function public.club_extend_membership_payment_grace"), migration.indexOf("create or replace function public.club_evaluate_membership_billing"));

test("manual grace is owner-automatic and otherwise requires an explicit capability", () => {
  assert.equal(hasClubCapability("owner", "payments.extend_grace"), true);
  assert.equal(hasClubCapability("gym_admin", "payments.extend_grace"), false);
  assert.equal(hasClubCapability("gym_staff", "payments.extend_grace"), false);
  assert.equal(hasClubCapability("trainer", "payments.extend_grace"), false);
  assert.equal(hasClubCapability("member", "payments.extend_grace", [{ capability: "payments.extend_grace", decision: "allow" }]), false);
  assert.equal(hasClubCapability("gym_admin", "payments.extend_grace", [{ capability: "payments.extend_grace", decision: "allow" }]), true);
  assert.match(migration, /m\.role='owner' and p_capability='payments\.extend_grace'/);
  assert.match(migration, /decision='allow'/);
  assert.doesNotMatch(migration, /Keenan|Peter|@/i);
});

test("only failed-payment lifecycle states expose the extension action", () => {
  for (const state of ["failed", "grace", "retry_scheduled", "overdue"]) assert.equal(isGraceExtensionEligible(state), true);
  for (const state of ["upcoming", "due", "payment_pending", "paid", "recovered", "waived", "cancelled"]) assert.equal(isGraceExtensionEligible(state), false);
  assert.match(migration, /o\.state not in \('failed','grace','retry_scheduled','overdue'\)/);
  assert.match(control, /context\.eligible \? <form/);
});

test("extension state distinguishes standard, extended, overdue, suspended and recovered", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const base = { state: "grace", suspended: false, extensionCount: 0, currentGraceExpiresAt: future };
  assert.equal(graceArrangementState(base), "Standard grace");
  assert.equal(graceArrangementState({ ...base, extensionCount: 1 }), "Extended grace");
  assert.equal(graceArrangementState({ ...base, state: "overdue", currentGraceExpiresAt: new Date(0).toISOString() }), "Overdue");
  assert.equal(graceArrangementState({ ...base, suspended: true }), "Suspended");
  assert.equal(graceArrangementState({ ...base, state: "recovered" }), "Recovered");
});

test("database approval is atomic, idempotent, immutable and preserves payment truth", () => {
  assert.match(migration, /where id=p_obligation_id and organisation_id=p_organisation_id for update/);
  assert.match(migration, /unique\(organisation_id,idempotency_key\)/);
  assert.match(migration, /unique\(obligation_id,sequence_number\)/);
  assert.match(migration, /Payment grace history is immutable/);
  assert.match(migration, /not isfinite\(p_new_grace_expires_at\)/);
  assert.match(migration, /p_new_grace_expires_at<=current_expiry/);
  assert.match(migration, /Imported payment reconciliation must be completed before extending grace/);
  assert.match(migration, /update public\.club_membership_payment_access_suspensions set active=false/);
  assert.doesNotMatch(approvalFunction, /update public\.club_membership_billing_obligations/i);
  assert.doesNotMatch(approvalFunction, /update public\.club_membership_billing_arrangements/i);
  assert.doesNotMatch(approvalFunction, /club_membership_billing_provider_events\s*\(/i);
});

test("shared-holder impact and recovery are recorded without overriding separate entitlements", () => {
  assert.match(migration, /from public\.club_membership_holders h/);
  assert.match(migration, /'covered_holders',holders/);
  assert.match(migration, /'covered_holder_count',jsonb_array_length\(holders\)/);
  assert.match(migration, /new\.state in \('paid','recovered'\)/);
  assert.match(migration, /closure_reason.*payment_recovered/);
  assert.match(migration, /on conflict\(obligation_id\) do update set active=true,cleared_at=null/);
  assert.match(migration, /from public\.club_membership_holders holder/);
  assert.match(migration, /holder\.membership_id=obligation\.membership_id/);
  assert.doesNotMatch(migration, /delete from public\.club_entitlement_grants|update public\.club_entitlement_grants/i);
});

test("staff profiles show the secure control and member-facing reads cannot see its notes", () => {
  assert.match(customerProfile, /ClubMembershipGraceExtension/);
  assert.match(memberProfile, /ClubMembershipGraceExtension/);
  assert.match(action, /"payments\.extend_grace"/);
  assert.match(migration, /not public\.club_capability_allowed\(p_organisation_id,auth\.uid\(\),'payments\.extend_grace'\)/);
  assert.match(migration, /revoke all on public\.club_membership_payment_grace_extensions,public\.club_membership_payment_grace_extension_closures from public,anon,authenticated/);
  assert.match(control, /Reason for extension/);
  assert.match(control, /Covered together/);
  assert.match(control, /Covered at approval/);
  assert.match(control, /Extension history/);
});
