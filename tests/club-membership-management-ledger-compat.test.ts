import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const fix = read("supabase/migrations/2027-02-11-club-membership-management-detail-ledger-compat.sql");
const providerSchema = read("supabase/migrations/2026-09-28-club-membership-billing-dunning.sql");
const page = read("app/club/members/customer/[customerId]/page.tsx");
const accessControl = read("components/club-membership-access-status.tsx");
const editor = read("components/club-member-profile-editor.tsx");
const actions = read("app/club/members/actions.ts");
const styles = read("components/club-member-management.module.css");

test("membership details use the actual provider payment columns rather than counter-ledger fields", () => {
  const paymentsSchema = providerSchema.slice(providerSchema.indexOf("create table if not exists public.club_membership_billing_payments"));
  const paymentsTable = paymentsSchema.slice(0, paymentsSchema.indexOf(");"));
  for (const wrong of ["receipt_date", "billing_period_start", "billing_period_end", "paid_through_date", "recorded_by", "verification_note"]) {
    assert.doesNotMatch(paymentsTable, new RegExp(`\\b${wrong}\\b`));
    assert.doesNotMatch(fix, new RegExp(`pay\\.${wrong}\\b`));
  }
  assert.match(fix, /pay\.occurred_at/);
  assert.match(fix, /pay\.provider_reference/);
  assert.match(fix, /o\.payment_method_family/);
  assert.match(fix, /club_membership_counter_payments cp/);
});

test("replacement detail RPC retains tenant/capability checks and authenticated-only execution", () => {
  assert.match(fix, /club_get_membership_management_detail\(p_organisation_id uuid,p_membership_id uuid\)/);
  assert.match(fix, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'memberships\.manage'\)/);
  assert.match(fix, /where id=p_membership_id and organisation_id=p_organisation_id/);
  assert.match(fix, /revoke all on function public\.club_get_membership_management_detail\(uuid,uuid\) from public,anon,authenticated/);
  assert.match(fix, /grant execute on function public\.club_get_membership_management_detail\(uuid,uuid\) to authenticated/);
});

test("cash payment action checks management capabilities and calls only the existing counter ledger RPC", () => {
  const action = actions.slice(actions.indexOf("export async function recordExistingMembershipCashPaymentAction"));
  assert.match(action, /memberships\.manage/);
  assert.match(action, /payments\.record_cash/);
  assert.match(action, /context\.role !== "owner" && context\.role !== "gym_admin"/);
  assert.match(action, /club_record_existing_membership_cash_payment/);
  assert.doesNotMatch(action, /stripe|gocardless|club_create_membership|club_enrol_membership_billing/);
});

test("customer profile distinguishes RPC failure and places account linking in a collapsed section", () => {
  assert.match(page, /club_get_membership_management_detail/);
  assert.match(page, /membershipManagementResults\[customerMemberships\.indexOf\(item\)\]\?\.error/);
  assert.match(page, /<details className=\{styles\.accountDetails\}>/);
  assert.match(page, /<summary>Link R12 account<\/summary>/);
  assert.match(page, /separate from Glow Zone age verification/);
  assert.match(editor, />Edit details<\/button>/);
});

test("access pause controls retain usable mobile layout", () => {
  assert.match(accessControl, /className=\{styles\.accessControls\}/);
  assert.match(styles, /\.accessControls\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*\.accessControls\s*\{\s*grid-template-columns:\s*1fr/);
});
