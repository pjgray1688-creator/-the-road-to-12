import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasClubCapability } from "@/lib/club-capabilities";

const read = (path: string) => readFileSync(path, "utf8");
const sql = read("supabase/migrations/2027-01-27-club-counter-membership-payments.sql");
const actions = read("app/club/members/actions.ts");
const intake = read("components/club-member-onboarding.tsx") + read("components/club-membership-assignment.tsx");
const collections = read("components/club-cash-collections.tsx");

test("cash and successful terminal payments receive one bounded provisional membership", () => {
  assert.match(sql, /p_method in \('cash','external_card'\).*club_assign_membership/s);
  assert.match(sql, /least\(now\(\)\+interval '7 days',coalesce\(actual_end,'infinity'::timestamptz\)\)/);
  assert.match(sql, /actual_end:=case when product\.duration_days is not null then p_starts_at\+make_interval\(days=>product\.duration_days\)/);
  assert.match(sql, /counter-provisional:/);
  assert.match(sql, /Existing provisional access requires management review or expiry/);
  assert.match(sql, /reconciliation_state='unreconciled' or prior\.provisional_expires_at>now\(\)/);
  assert.match(actions, /provisionalExpiresAt/);
});

test("bank claims never activate access and external terminal references are optional", () => {
  assert.match(sql, /method='bank_transfer' and provisional_expires_at is null and membership_id is null/);
  assert.match(sql, /p_method='bank_transfer'.*Bank transfer reference is required/s);
  assert.match(sql, /p_method='external_card'.*p_terminal_success_confirmed/s);
  assert.match(sql, /method<>'bank_transfer' or coalesce\(char_length\(btrim\(external_reference\)\),0\)>0/);
  assert.doesNotMatch(sql, /p_method='external_card' and nullif\(btrim\(p_external_reference\)/);
  assert.match(intake, /I saw the external terminal show a successful payment/);
  assert.match(intake, /required=\{method === "bank_transfer"\}/);
});

test("counter evidence is organisation-scoped, idempotent, audited and contains no card data", () => {
  assert.match(sql, /unique\(organisation_id,idempotency_key\)/);
  assert.match(sql, /club_membership_counter_payments_fingerprint_uidx/);
  assert.match(sql, /foreign key\(product_id,organisation_id\)/);
  assert.match(sql, /foreign key\(customer_id,organisation_id\)/);
  assert.match(sql, /membership\.payment_initiated/);
  assert.match(sql, /membership\.payment_'.*p_decision/s);
  assert.match(sql, /membership\.payment_corrected/);
  assert.doesNotMatch(sql, /card_number|cvv|pan_number/i);
  assert.doesNotMatch(sql, /stripe_secret|stripe\.payment/i);
  assert.match(read("lib/stripe-routing-policy.ts"), /madhouse_franchise/);
});

test("management confirmation extends the same provisional membership and rejection removes access", () => {
  assert.match(sql, /payment\.membership_id is null/);
  assert.match(sql, /update public\.club_memberships set status='active',ends_at=end_at/);
  assert.match(sql, /update public\.club_entitlement_grants set ends_at=end_at/);
  assert.match(sql, /status='cancelled'.*Counter payment evidence rejected/s);
  assert.match(sql, /payment\.method='cash'.*'cash\.reconcile'/s);
  assert.match(sql, /club_correct_membership_counter_payment/);
  assert.match(sql, /p_capability_allowed|club_capability_allowed/);
});

test("cash collections are immutable, venue-specific physical cutoffs rather than till closes", () => {
  assert.match(sql, /create table public\.club_cash_box_collections/);
  assert.match(sql, /unique\(organisation_id,location_id,collected_at\)/);
  assert.match(sql, /period_started_at/);
  assert.match(sql, /p\.location_id=p_location_id/);
  assert.match(sql, /d\.location_id=p_location_id/);
  assert.match(sql, /p\.method='cash'.*not exists\(select 1 from public\.club_cash_declarations/s);
  assert.match(sql, /select -r\.amount_minor from public\.club_refunds/);
  assert.match(sql, /payment_received_at<=p_collected_at/);
  assert.match(sql, /declared_at<=p_collected_at/);
  assert.match(sql, /variance_minor=collected_amount_minor-expected_amount_minor/);
  assert.match(sql, /Cash collection history is immutable/);
  assert.doesNotMatch(sql, /till_close|close.*calendar|daily closing/i);
  assert.match(collections, /does not close a day, week, till or another venue/);
});

test("late historical cash is flagged without rewriting collection snapshots", () => {
  assert.match(sql, /create table public\.club_cash_collection_late_movements/);
  assert.match(sql, /recorded>c\.recorded_at/);
  assert.match(sql, /occurred<=c\.collected_at/);
  assert.match(sql, /club_cash_declaration_late_flag/);
  assert.match(sql, /club_counter_payment_late_cash_flag/);
  assert.match(sql, /club_payment_late_cash_flag/);
  assert.match(sql, /club_refund_late_cash_flag/);
  assert.match(sql, /club_resolve_late_cash_movement/);
  assert.doesNotMatch(sql, /update public\.club_cash_box_collections/);
  assert.match(collections, /never rewrite the original expected amount/);
});

test("payment and sensitive pricing permissions remain narrow and server-authoritative", () => {
  assert.equal(hasClubCapability("owner", "memberships.pricing_sensitive"), true);
  assert.equal(hasClubCapability("gym_admin", "memberships.pricing_sensitive"), false);
  assert.equal(hasClubCapability("gym_staff", "membership_payments.verify"), false);
  assert.equal(hasClubCapability("gym_staff", "membership_payments.verify", [{ capability: "membership_payments.verify", decision: "allow" }]), true);
  assert.match(sql, /club_record_cash_box_collection[\s\S]+cash\.reconcile/);
  assert.match(sql, /club_correct_membership_counter_payment[\s\S]+finance\.manage/);
  assert.match(sql, /club_set_family_contract_terms[\s\S]+memberships\.pricing_sensitive/);
  assert.match(sql, /club_list_membership_counter_payments[\s\S]+payment\.initiated_by=auth\.uid\(\)/);
});
