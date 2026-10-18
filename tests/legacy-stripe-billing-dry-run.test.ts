import test from "node:test";
import assert from "node:assert/strict";
import { stripeBillingDryRunCsv, validateLegacyStripeBillingDryRun, validateProposedExternalBasket } from "../lib/legacy-stripe-billing-dry-run";

const membershipCsvs = [{ site: "Rotherham", csv: "MemberId,BranchId,Membership Status\n42,ROTH,active" }];
const proposal = (overrides: Record<string, string> = {}) => ({
  "Transaction Type": "membership_renewal", "Receiving Legal Entity Number": "17383077",
  Site: "Rotherham", BranchId: "ROTH", MemberId: "42", "Stripe Account ID": "acct_franchise",
  "Stripe Customer Account ID": "acct_franchise", "Stripe Payment Method Account ID": "acct_franchise",
  "Stripe Customer ID": "cus_privatecustomer", "Stripe Payment Method ID": "pm_privatemethod", "Payment Method Customer ID": "cus_privatecustomer",
  "Amount Minor": "2200", "Application Fee Minor": "11", Currency: "GBP", Frequency: "monthly", "Next Due At": "2027-01-15",
  "Paid Through At": "2026-12-15", "Membership Status": "active", "Payment Method Status": "active",
  "Off Session Authorized": "yes", "Authorization Evidence Reference": "consent-record-17",
  "Legacy Schedule Status": "stopped", "R12 Arrangement Status": "none", "R12 Obligation Status": "none", "Collection Status": "none",
  ...overrides,
});
const csv = (rows: Array<Record<string, string>>) => {
  const headers = Object.keys(rows[0]);
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [headers, ...rows.map(row => headers.map(header => row[header] ?? ""))].map(row => row.map(quote).join(",")).join("\n");
};
const run = (rows: Array<Record<string, string>>, mappings = { franchiseMembershipAccountId: "acct_franchise" }, memberships = membershipCsvs) => validateLegacyStripeBillingDryRun({
  organisationId: "org-1", membershipCsvs: memberships, proposalsCsv: csv(rows), merchantMappings: mappings, asOf: new Date("2027-02-01T00:00:00Z"),
});

test("both gym locations route membership proposals to the same Franchise merchant irrespective of site", async () => {
  const first = await run([proposal()]);
  const repeated = await run([proposal()]);
  assert.equal(first.ready, 1);
  assert.equal(first.rows[0].ready, true);
  assert.equal(first.rows[0].idempotencyKey, repeated.rows[0].idempotencyKey);
  assert.match(first.rows[0].idempotencyKey, /^r12-legacy-stripe-[a-f0-9]{64}$/);
  const carlton = await run([proposal({ Site: "Carlton", BranchId: "CARL" })], undefined, [{ site: "Carlton", csv: "MemberId,BranchId,Membership Status\n42,CARL,active" }]);
  assert.equal(carlton.rows[0].ready, true);
  assert.notEqual(first.rows[0].idempotencyKey, carlton.rows[0].idempotencyKey);
});

test("missing Franchise merchant mapping and wrong legal-entity Stripe account are blocked", async () => {
  const missing = await run([proposal()], { franchiseMembershipAccountId: "" });
  assert.ok(missing.rows[0].blockers.includes("trusted_merchant_mapping_missing"));
  const mismatch = await run([proposal({ "Stripe Account ID": "acct_mps" })]);
  assert.ok(mismatch.rows[0].blockers.includes("stripe_account_mismatch"));
  const wrongEntity = await run([proposal({ "Receiving Legal Entity Number": "17383213" })]);
  assert.ok(wrongEntity.rows[0].blockers.includes("membership_merchant_legal_entity_mismatch"));
  assert.ok(wrongEntity.rows[0].blockers.includes("FUTURE_ROUTING_VIOLATION"));
  const wrongType = await run([proposal({ "Transaction Type": "shop" })]);
  assert.ok(wrongType.rows[0].blockers.includes("transaction_type_not_membership"));
  const wrongPmAccount = await run([proposal({ "Stripe Payment Method Account ID": "acct_mps" })]);
  assert.ok(wrongPmAccount.rows[0].blockers.includes("payment_method_merchant_account_mismatch"));
  assert.ok(wrongPmAccount.rows[0].blockers.includes("FUTURE_ROUTING_VIOLATION"));
});

test("unmatched and ambiguous legacy identities never resolve from email", async () => {
  const unmatched = await run([proposal({ MemberId: "99" })]);
  assert.ok(unmatched.rows[0].blockers.includes("membership_identity_unmatched"));
  const ambiguous = await run([proposal()], undefined, [
    { site: "Rotherham", csv: "MemberId,BranchId\n42,ROTH\n42,ROTH" },
  ]);
  assert.ok(ambiguous.rows[0].blockers.includes("membership_identity_ambiguous"));
  const inactive = await run([proposal()], undefined, [{ site: "Rotherham", csv: "MemberId,BranchId,Membership Status\n42,ROTH,cancelled" }]);
  assert.ok(inactive.rows[0].blockers.includes("source_membership_not_active"));
});

test("invalid schedule, amount, currency, not-yet-due date and paid-through coverage are blocked", async () => {
  const result = await run([proposal({ "Amount Minor": "0", Currency: "gbp!", Frequency: "", "Next Due At": "2028-01-15", "Paid Through At": "2028-01-20" })]);
  assert.ok(result.rows[0].blockers.includes("amount_invalid"));
  assert.ok(result.rows[0].blockers.includes("currency_invalid"));
  assert.ok(result.rows[0].blockers.includes("frequency_missing_or_unsupported"));
  assert.ok(result.rows[0].blockers.includes("not_due_yet"));
  assert.ok(result.rows[0].blockers.includes("payment_coverage_reaches_due_date"));
  const fee = await run([proposal({ "Application Fee Minor": "2201" })]);
  assert.ok(fee.rows[0].blockers.includes("application_fee_invalid_or_missing"));
});

test("cancelled authority and missing off-session authorisation/evidence are rejected", async () => {
  const result = await run([proposal({ "Payment Method Status": "cancelled", "Off Session Authorized": "no", "Authorization Evidence Reference": "" })]);
  assert.ok(result.rows[0].blockers.includes("payment_authority_not_active"));
  assert.ok(result.rows[0].blockers.includes("off_session_authorization_not_evidenced"));
});

test("payment method must belong to the exact account-scoped customer reference", async () => {
  const result = await run([proposal({ "Payment Method Customer ID": "cus_other" })]);
  assert.ok(result.rows[0].blockers.includes("payment_method_customer_relationship_unverified"));
});

test("active legacy schedules and possible R12 collection windows block duplicate collection", async () => {
  const result = await run([
    proposal({ "Legacy Schedule Status": "active" }),
    proposal({ "R12 Arrangement Status": "active" }),
  ]);
  assert.ok(result.rows[0].blockers.includes("legacy_schedule_not_confirmed_stopped"));
  assert.ok(result.rows[1].blockers.includes("existing_r12_arrangement_may_collect"));
  const otherProvider = await run([proposal({ "Other Provider Schedule Status": "active" })]);
  assert.ok(otherProvider.rows[0].blockers.includes("other_provider_schedule_may_collect"));
  const duplicate = await run([proposal(), proposal()]);
  assert.ok(duplicate.rows[0].blockers.includes("duplicate_collection_window"));
  assert.ok(duplicate.rows[1].blockers.includes("duplicate_collection_window"));
  const crossScope = await run([proposal(), proposal({ Site: "Carlton", BranchId: "CARL" })], undefined, [
    { site: "Rotherham", csv: "MemberId,BranchId,Membership Status\n42,ROTH,active" },
    { site: "Carlton", csv: "MemberId,BranchId,Membership Status\n42,CARL,active" },
  ]);
  assert.ok(crossScope.rows.every(row => row.blockers.includes("cross_scope_duplicate_member_window")));
});

test("reports never include customer, payment-method or authorisation references", async () => {
  const result = await run([proposal()]);
  const report = stripeBillingDryRunCsv(result);
  assert.doesNotMatch(report, /cus_privatecustomer|pm_privatemethod|consent-record-17/);
  assert.match(report, /dry_run_ready_not_enabled/);
});

test("proposed mixed-entity external baskets are blocked instead of routing all lines to one merchant", () => {
  assert.deepEqual(validateProposedExternalBasket([
    { transactionType: "membership", amountMinor: 1000 },
    { transactionType: "shop", amountMinor: 2500 },
  ]), { allowed: false, legalEntityNumber: null, blockedReason: "mixed_legal_entities_blocked" });
  assert.equal(validateProposedExternalBasket([{ transactionType: "membership", amountMinor: 1000 }]).legalEntityNumber, "17383077");
  assert.equal(validateProposedExternalBasket([{ transactionType: "pt", amountMinor: 1000 }]).legalEntityNumber, "17383213");
});
