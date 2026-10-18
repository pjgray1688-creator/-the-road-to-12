import test from "node:test";
import assert from "node:assert/strict";
import { buildLegacyPaymentReconciliationPreview, reconciliationIssuesCsv, type ReconciliationSource } from "../lib/legacy-payment-reconciliation";

const source = (id: string, kind: ReconciliationSource["kind"], site: string, account: string, csv: string, entity = kind === "membership" ? "" : "17383077"): ReconciliationSource => ({ id, kind, site, merchantAccount: account, stripeLegacyAccountLabel: kind === "stripe" ? entity === "17383077" ? "Rotherham" : entity === "17383213" ? "Carlton" : "" : "", merchantLegalEntityNumber: entity, fileName: `${id}.csv`, csv });
const members = (csv: string, site = "Rotherham") => source(`members-${site}`, "membership", site, "", csv);
const stripe = (csv: string, site = "Rotherham", account = "Franchise Stripe", entity = "17383077") => source(`stripe-${site}-${account}`, "stripe", site, account, csv, entity);
const gc = (csv: string, site = "Rotherham", account = `${site} GoCardless`) => source(`gc-${site}-${account}`, "gocardless", site, account, csv);

test("duplicate emails are reported but never used as confirmed payment identity", () => {
  const result = buildLegacyPaymentReconciliationPreview("org", [
    members("MemberId,BranchId,Email\n10,ROTH,shared@example.test\n11,ROTH,shared@example.test"),
    stripe("id,Metadata MemberId,Metadata BranchId,email\ncus_a,,ROTH,shared@example.test"),
  ]);
  assert.equal(result.summary.emailOnlyOverlaps, 1);
  assert.equal(result.summary.exactIdentityMatches, 0);
  assert.ok(result.issues.some(issue => issue.kind.includes("multiple membership rows")));
  assert.ok(result.issues.some(issue => issue.kind.includes("Email overlap only")));
  assert.doesNotMatch(reconciliationIssuesCsv(result), /shared@example\.test/);
});

test("repeated MemberIds across branches and sites remain separate and flagged", () => {
  const result = buildLegacyPaymentReconciliationPreview("org", [
    members("MemberId,BranchId,Email\n42,ROTH,one@example.test\n42,CARL,two@example.test"),
    members("MemberId,BranchId,Email\n42,CARL,two@example.test", "Carlton"),
    stripe("id,MemberId,BranchId,email\ncus_roth,42,ROTH,one@example.test"),
    stripe("id,MemberId,BranchId,email\ncus_carlton,42,CARL,two@example.test", "Carlton", "Franchise Stripe"),
  ]);
  assert.equal(result.summary.exactIdentityMatches, 2);
  assert.ok(result.issues.some(issue => issue.kind.includes("across sites")));
  assert.ok(result.issues.some(issue => issue.kind.includes("repeats across branches")));
  assert.ok(!result.issues.some(issue => issue.kind.includes("Duplicate membership source reference")));
});

test("provider IDs are deduplicated within account, not across distinct merchant accounts", () => {
  const csv = "id,MemberId,BranchId,email\ncus_same,7,ROTH,member@example.test";
  const result = buildLegacyPaymentReconciliationPreview("org", [members("MemberId,BranchId,Email\n7,ROTH,member@example.test"), stripe(csv), stripe(csv, "Rotherham", "Rotherham Stripe 2")]);
  assert.equal(result.summary.exactIdentityMatches, 2);
  assert.equal(result.summary.duplicateCustomerRecords, 0);
  assert.equal(result.issues.filter(issue => issue.kind.includes("Duplicate provider customer")).length, 0);
});

test("duplicate provider customer records within one account are flagged", () => {
  const result = buildLegacyPaymentReconciliationPreview("org", [
    members("MemberId,BranchId,Email\n7,ROTH,member@example.test"),
    stripe("id,MemberId,BranchId,email\ncus_dup,7,ROTH,member@example.test\ncus_dup,7,ROTH,member@example.test"),
  ]);
  assert.equal(result.summary.duplicateCustomerRecords, 2);
  assert.ok(result.issues.some(issue => issue.kind.includes("Duplicate provider customer row")));
});

test("duplicate provider emails are flagged as review clues, not merged", () => {
  const result = buildLegacyPaymentReconciliationPreview("org", [
    members("MemberId,BranchId,Email\n7,ROTH,member@example.test"),
    stripe("id,email\ncus_one,member@example.test\ncus_two,member@example.test"),
  ]);
  assert.equal(result.summary.exactIdentityMatches, 0);
  assert.ok(result.issues.some(issue => issue.kind.includes("Email overlap only")));
  assert.ok(result.issues.some(issue => issue.kind.includes("Email repeats among customers")));
  assert.doesNotMatch(reconciliationIssuesCsv(result), /member@example\.test/);
});

test("cancelled GoCardless mandate is distinct from payment evidence and membership state", () => {
  const result = buildLegacyPaymentReconciliationPreview("org", [members("MemberId,BranchId,Membership Status\n8,ROTH,active"), gc("id,MemberId,BranchId,Mandate ID,Mandate Status,Payment ID\ncu_8,8,ROTH,MD_8,cancelled,")]);
  assert.equal(result.summary.cancelledMandates, 1);
  assert.equal(result.summary.activeMandates, 0);
  assert.equal(result.summary.paymentEvidenceRows, 0);
  assert.equal(result.missingScheduleFields["amount"], 1);
  assert.equal(result.missingScheduleFields["next due date"], 1);
});

test("missing metadata and account provenance are surfaced without email-based linkage", () => {
  const result = buildLegacyPaymentReconciliationPreview("org", [
    members("MemberId,BranchId,Email\n9,ROTH,member@example.test"),
    stripe("id,email\ncus_9,member@example.test", "Rotherham", ""),
  ]);
  assert.equal(result.summary.exactIdentityMatches, 0);
  assert.equal(result.summary.emailOnlyOverlaps, 1);
  assert.ok(result.issues.some(issue => issue.kind.includes("MemberId metadata missing")));
  assert.ok(result.issues.some(issue => issue.kind.includes("BranchId metadata missing")));
  assert.ok(result.errors.some(error => error.includes("explicit merchant account")));
});

test("mixed Stripe and GoCardless records are reported as separate provider relationships", () => {
  const memberCsv = "MemberId,BranchId,Email,Amount,Frequency,Next Payment Date,Paid Through,Collection Status\n12,ROTH,m@example.test,42,monthly,2027-01-01,2026-12-31,paid";
  const result = buildLegacyPaymentReconciliationPreview("org", [
    members(memberCsv),
    stripe("id,MemberId,BranchId,email\ncus_12,12,ROTH,m@example.test"),
    gc("id,MemberId,BranchId,email,Mandate Status\ncu_12,12,ROTH,m@example.test,active"),
  ]);
  assert.equal(result.summary.exactIdentityMatches, 2);
  assert.ok(result.issues.some(issue => issue.source === "cross-provider"));
  assert.deepEqual(result.missingScheduleFields, { "amount": 0, "frequency": 0, "next due date": 0, "paid-through date": 0, "collection status": 0 });
});

test("Club Manager, Stripe and GoCardless export header variants are recognised with account/site provenance", () => {
  const result = buildLegacyPaymentReconciliationPreview("org", [
    members("Member ID,Branch ID,Email Address,Membership Status\n12,ROTH,m@example.test,Active"),
    stripe("Customer ID,Customer Email,Metadata: MemberId,Metadata: BranchId\ncus_12,m@example.test,12,ROTH", "Rotherham", "Franchise Stripe · 17383077"),
    gc("Customer ID,Email Address,Club Manager Member ID,Club Manager Branch ID,Mandate ID,Mandate Status\ncu_12,m@example.test,12,ROTH,MD_12,active", "Rotherham", "Rotherham GoCardless creditor account"),
  ]);
  assert.equal(result.summary.membershipRows, 1);
  assert.equal(result.summary.providerRows, 2);
  assert.equal(result.summary.exactIdentityMatches, 2);
  assert.ok(result.sourceSchemas.every(schema => schema.missingRequiredFields.length === 0));
  assert.equal(result.issues.filter(issue => issue.kind.includes("both Stripe and GoCardless")).length, 1);
});

test("unrecognised headers and missing source identity columns are explicitly reported", () => {
  const result = buildLegacyPaymentReconciliationPreview("org", [
    members("MemberName,BranchName,Email,Legacy Extra Column\nSample,North,m@example.test,ignored"),
    stripe("Customer ID,Email,Opaque Export Field\ncus_1,m@example.test,ignored", "Rotherham", "Franchise Stripe · 17383077"),
  ]);
  const memberSchema = result.sourceSchemas.find(schema => schema.source.startsWith("members-"));
  const stripeSchema = result.sourceSchemas.find(schema => schema.source.startsWith("stripe-"));
  assert.deepEqual(memberSchema?.missingRequiredFields, ["Club Manager MemberId", "Club Manager BranchId"]);
  assert.ok(memberSchema?.unsupportedHeaders.includes("legacy extra column"));
  assert.deepEqual(stripeSchema?.missingRequiredFields, ["Club Manager MemberId", "Club Manager BranchId"]);
  assert.ok(stripeSchema?.unsupportedHeaders.includes("opaque export field"));
  assert.ok(result.issues.some(issue => issue.kind.includes("MemberId metadata missing")));
});

test("historical Stripe labels map to their actual legal owners, independently of the gym/site", () => {
  const rows = "Customer ID,Metadata MemberId,Metadata BranchId\ncus_x,42,BRANCH";
  const sixSources = buildLegacyPaymentReconciliationPreview("org", [
    members("MemberId,BranchId\n42,BRANCH"), members("MemberId,BranchId\n42,BRANCH", "Carlton"),
    stripe(rows, "Rotherham", "acct_rotherham"), stripe(rows, "Carlton", "acct_carlton", "17383213"),
    gc("Customer ID,Metadata MemberId,Metadata BranchId\ncu_x,42,BRANCH", "Rotherham", "creditor_rotherham"),
    gc("Customer ID,Metadata MemberId,Metadata BranchId\ncu_x,42,BRANCH", "Carlton", "creditor_carlton"),
  ]);
  assert.equal(sixSources.errors.length, 0);
  assert.equal(sixSources.summary.exactIdentityMatches, 4);
  const mismatchedSource = stripe(rows, "Carlton", "acct_rotherham", "17383213");
  mismatchedSource.stripeLegacyAccountLabel = "Rotherham";
  const labelMismatch = buildLegacyPaymentReconciliationPreview("org", [mismatchedSource]);
  assert.ok(labelMismatch.errors.some(error => error.includes("conflicts with the historical Stripe account label")));
  const collapsedGc = buildLegacyPaymentReconciliationPreview("org", [
    gc("Customer ID\ncu_x", "Rotherham", "generic_gocardless"), gc("Customer ID\ncu_y", "Carlton", "generic_gocardless"),
  ]);
  assert.ok(collapsedGc.errors.some(error => error.includes("distinct historical creditor/account provenance")));
});

test("MPS Stripe customer matches are identity-only, not proof of membership or payment authority", () => {
  const result = buildLegacyPaymentReconciliationPreview("org", [
    members("MemberId,BranchId,Email\n42,ROTH,m@example.test"),
    stripe("Customer ID,MemberId,BranchId,Email,Payment Reference\ncus_shop,42,ROTH,m@example.test,pi_old", "Rotherham", "acct_mps", "17383213"),
  ]);
  assert.equal(result.summary.exactIdentityMatches, 1);
  assert.ok(result.issues.some(issue => issue.kind.includes("Stripe customer identity match only")));
  assert.equal(result.summary.paymentEvidenceRows, 1);
  assert.equal(result.summary.legacyAccountExceptions, 0);
});

test("Stripe customer or payment-reference rows do not inflate GoCardless mandate counts", () => {
  const result = buildLegacyPaymentReconciliationPreview("org", [
    members("MemberId,BranchId\n42,ROTH"),
    stripe("Customer ID,MemberId,BranchId,Mandate Status,Payment Reference\ncus_42,42,ROTH,active,pi_old"),
  ]);
  assert.equal(result.summary.activeMandates, 0);
  assert.equal(result.summary.paymentEvidenceRows, 1);
  assert.equal(result.summary.legacyAccountExceptions, 0);
});

test("explicit legacy MPS membership arrangement is classified as review-only exception", () => {
  const result = buildLegacyPaymentReconciliationPreview("org", [
    members("MemberId,BranchId,Membership Status,Billing Arrangement ID,Billing Status\n42,ROTH,active,legacy-schedule-42,cancelled"),
    stripe("Customer ID,MemberId,BranchId,Payment Reference\ncus_42,42,ROTH,pi_old", "Rotherham", "acct_carlton_legacy", "17383213"),
  ]);
  assert.equal(result.summary.exactIdentityMatches, 1);
  assert.equal(result.summary.paymentEvidenceRows, 1);
  assert.equal(result.summary.legacyAccountExceptions, 1);
  const exception = result.issues.find(issue => issue.code === "LEGACY_ACCOUNT_EXCEPTION");
  assert.equal(exception?.severity, "review");
  assert.match(exception?.kind ?? "", /Preserve its account and references/);
  assert.equal(result.errors.length, 0);
});

test("unrecognised merchant legal entities are rejected during source review", () => {
  const result = buildLegacyPaymentReconciliationPreview("org", [
    stripe("Customer ID\ncus_1", "Rotherham", "acct_other", "00000000"),
  ]);
  assert.ok(result.errors.some(error => error.includes("historical Stripe account label")));
});
