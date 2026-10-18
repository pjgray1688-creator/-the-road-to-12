import { parseCsvRecords } from "./club-csv";

/** The only merchant mapping accepted for this membership-only proposal preview. */
export type StripeMerchantMappings = { franchiseMembershipAccountId: string };

export type StripeBillingDryRunRow = {
  row: number;
  site: string;
  amountMinor: number | null;
  applicationFeeMinor: number | null;
  currency: string;
  frequency: string;
  dueAt: string;
  idempotencyKey: string;
  ready: boolean;
  blockers: string[];
};

export type StripeBillingDryRun = {
  total: number;
  ready: number;
  blocked: number;
  errors: string[];
  rows: StripeBillingDryRunRow[];
};

export type ProposedExternalSaleType = "membership" | "shop" | "supplement" | "merchandise" | "glow_zone" | "pt" | "other_non_membership";
export type ProposedMerchantEntity = "17383077" | "17383213";

/** Policy helper for future proposal design only; deliberately not wired into production checkout. */
export function validateProposedExternalBasket(lines: Array<{ transactionType: ProposedExternalSaleType; amountMinor: number }>) {
  const entityFor = (type: ProposedExternalSaleType): ProposedMerchantEntity => type === "membership" ? "17383077" : "17383213";
  const entities = new Set(lines.map(line => entityFor(line.transactionType)));
  const invalidAmounts = lines.some(line => !Number.isSafeInteger(line.amountMinor) || line.amountMinor <= 0);
  return {
    allowed: lines.length > 0 && !invalidAmounts && entities.size === 1,
    legalEntityNumber: entities.size === 1 ? [...entities][0] : null,
    blockedReason: !lines.length ? "basket_empty" : invalidAmounts ? "line_amount_invalid" : entities.size > 1 ? "mixed_legal_entities_blocked" : null,
  } as const;
}

type Proposal = {
  site: string; branchId: string; memberId: string; accountId: string;
  customerAccountId: string; paymentMethodAccountId: string; transactionType: string; legalEntityNumber: string;
  customerId: string; paymentMethodId: string; paymentMethodCustomerId: string;
  amount: string; applicationFee: string; currency: string; frequency: string; nextDue: string; paidThrough: string;
  membershipStatus: string; authorityStatus: string; offSessionAuthorized: string;
  authorizationEvidence: string; legacyScheduleStatus: string;
  r12ArrangementStatus: string; r12ObligationStatus: string; collectionStatus: string; otherProviderScheduleStatus: string;
};

const key = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en-GB").replace(/[^a-z0-9]/g, "");
const value = (row: Record<string, string>, ...names: string[]) => {
  const entries = Object.entries(row).map(([name, field]) => [key(name), String(field ?? "").trim()] as const);
  for (const name of names) {
    const wanted = key(name);
    const found = entries.find(([candidate]) => candidate === wanted)?.[1];
    if (found) return found;
  }
  return "";
};
const identityKey = (site: string, branch: string, member: string) => `${key(site)}|${key(branch)}|${key(member)}`;
const validDate = (input: string) => {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(input)) return null;
  const [year, month, day] = input.slice(0, 10).split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const isYes = (input: string) => ["yes", "true", "1", "confirmed"].includes(key(input));
const text = (row: Record<string, string>, names: string[]) => value(row, ...names);

async function proposalIdempotencyKey(parts: string[]) {
  const bytes = new TextEncoder().encode(parts.map(part => part.normalize("NFKC").trim().toLocaleLowerCase("en-GB")).join("\u001f"));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return `r12-legacy-stripe-${hex}`;
}

/** Local-only proposal validation. It never contacts Stripe or persists a provider reference. */
export async function validateLegacyStripeBillingDryRun(input: {
  organisationId: string;
  membershipCsvs: Array<{ site: string; csv: string }>;
  proposalsCsv: string;
  merchantMappings: StripeMerchantMappings;
  asOf?: Date;
}): Promise<StripeBillingDryRun> {
  const errors: string[] = [];
  if (!input.organisationId.trim()) errors.push("An organisation context is required.");
  let proposalRows: Record<string, string>[] = [];
  const membershipRows: Array<{ row: Record<string, string>; site: string }> = [];
  for (const source of input.membershipCsvs) {
    try { membershipRows.push(...parseCsvRecords(source.csv, true).map(row => ({ row, site: source.site }))); }
    catch { errors.push("Membership CSV format is invalid."); }
  }
  try { proposalRows = parseCsvRecords(input.proposalsCsv, true); }
  catch { errors.push("Stripe proposal CSV format is invalid."); }

  const memberships = new Map<string, { count: number; statuses: string[] }>();
  for (const source of membershipRows) {
    const site = text(source.row, ["Site", "Location"]) || source.site;
    const branch = text(source.row, ["BranchId", "Branch ID"]);
    const member = text(source.row, ["MemberId", "Member ID"]);
    if (site && branch && member) {
      const identity = identityKey(site, branch, member);
      const previous = memberships.get(identity) ?? { count: 0, statuses: [] };
      previous.count += 1;
      previous.statuses.push(text(source.row, ["Membership Status", "Status", "Member Status"]));
      memberships.set(identity, previous);
    }
  }

  const parsed: Proposal[] = proposalRows.map(row => ({
    site: text(row, ["Site", "Location"]), branchId: text(row, ["BranchId", "Branch ID"]), memberId: text(row, ["MemberId", "Member ID"]),
    transactionType: text(row, ["Transaction Type", "Payment Purpose"]), legalEntityNumber: text(row, ["Receiving Legal Entity Number", "Merchant Company Number", "Legal Entity Number"]),
    accountId: text(row, ["Stripe Account ID", "Merchant Account ID", "Account ID"]),
    customerAccountId: text(row, ["Stripe Customer Account ID", "Customer Merchant Account ID"]),
    paymentMethodAccountId: text(row, ["Stripe Payment Method Account ID", "Payment Method Merchant Account ID"]),
    customerId: text(row, ["Stripe Customer ID", "Customer ID"]), paymentMethodId: text(row, ["Stripe Payment Method ID", "Payment Method ID"]),
    paymentMethodCustomerId: text(row, ["Payment Method Customer ID", "Payment Method Owner Customer ID"]),
    amount: text(row, ["Amount Minor", "Amount (minor units)"]), applicationFee: text(row, ["Application Fee Minor"]), currency: text(row, ["Currency"]),
    frequency: text(row, ["Frequency", "Billing Frequency"]), nextDue: text(row, ["Next Due At", "Next Due Date"]),
    paidThrough: text(row, ["Paid Through At", "Paid Through Date"]), membershipStatus: text(row, ["Membership Status"]),
    authorityStatus: text(row, ["Payment Method Status", "Authority Status"]), offSessionAuthorized: text(row, ["Off Session Authorized", "Off-session Authorized"]),
    authorizationEvidence: text(row, ["Authorization Evidence Reference", "Off-session Authorization Evidence"]),
    legacyScheduleStatus: text(row, ["Legacy Schedule Status"]), r12ArrangementStatus: text(row, ["R12 Arrangement Status"]),
    r12ObligationStatus: text(row, ["R12 Obligation Status"]), collectionStatus: text(row, ["Collection Status", "Last Collection Status"]),
    otherProviderScheduleStatus: text(row, ["Other Provider Schedule Status", "GoCardless Schedule Status"]),
  }));

  const counts = new Map<string, number>();
  for (const row of parsed) if (row.site && row.branchId && row.memberId) {
    const identity = identityKey(row.site, row.branchId, row.memberId);
    counts.set(identity, (counts.get(identity) ?? 0) + 1);
  }
  const periodCounts = new Map<string, number>();
  const crossScopeCounts = new Map<string, number>();
  for (const row of parsed) {
    const due = validDate(row.nextDue);
    if (!due || !row.memberId) continue;
    const period = due.toISOString().slice(0, 10);
    const identity = identityKey(row.site, row.branchId, row.memberId);
    const collectionKey = `${identity}|${key(row.accountId)}|${period}`;
    periodCounts.set(collectionKey, (periodCounts.get(collectionKey) ?? 0) + 1);
    const crossScopeKey = `${key(row.memberId)}|${period}`;
    crossScopeCounts.set(crossScopeKey, (crossScopeCounts.get(crossScopeKey) ?? 0) + 1);
  }
  const asOf = input.asOf ?? new Date();
  const rows: StripeBillingDryRunRow[] = [];
  for (const [index, proposal] of parsed.entries()) {
    const blockers: string[] = [];
    const identity = identityKey(proposal.site, proposal.branchId, proposal.memberId);
    if (!input.organisationId.trim()) blockers.push("organisation_missing");
    if (!proposal.site || !["rotherham", "carlton"].includes(key(proposal.site))) blockers.push("site_invalid");
    if (!proposal.branchId || !proposal.memberId) blockers.push("source_identity_missing");
    const matchedMembership = memberships.get(identity);
    if (proposal.branchId && proposal.memberId && matchedMembership?.count !== 1) blockers.push(matchedMembership ? "membership_identity_ambiguous" : "membership_identity_unmatched");
    if (matchedMembership?.count === 1 && !new Set(["active", "current", "live"]).has(key(matchedMembership.statuses[0] ?? ""))) blockers.push("source_membership_not_active");

    const site = key(proposal.site) === "rotherham" ? "Rotherham" : key(proposal.site) === "carlton" ? "Carlton" : null;
    // Both locations' gym memberships are owned by Madhouse Franchise Ltd.
    // Location/BranchId are identity and operational provenance only.
    const expectedAccount = input.merchantMappings.franchiseMembershipAccountId?.trim() ?? "";
    if (!expectedAccount) blockers.push("trusted_merchant_mapping_missing");
    else if (!/^acct_[A-Za-z0-9]+$/.test(expectedAccount)) blockers.push("merchant_mapping_invalid");
    const routeViolations: string[] = [];
    if (!/^acct_[A-Za-z0-9]+$/.test(proposal.accountId)) blockers.push("stripe_account_missing_or_invalid");
    else if (expectedAccount && proposal.accountId !== expectedAccount) { blockers.push("stripe_account_mismatch"); routeViolations.push("account"); }
    if (!/^acct_[A-Za-z0-9]+$/.test(proposal.customerAccountId)) blockers.push("customer_merchant_provenance_missing_or_invalid");
    else if (expectedAccount && proposal.customerAccountId !== expectedAccount) { blockers.push("customer_merchant_account_mismatch"); routeViolations.push("customer_account"); }
    if (!/^acct_[A-Za-z0-9]+$/.test(proposal.paymentMethodAccountId)) blockers.push("payment_method_merchant_provenance_missing_or_invalid");
    else if (expectedAccount && proposal.paymentMethodAccountId !== expectedAccount) { blockers.push("payment_method_merchant_account_mismatch"); routeViolations.push("payment_method_account"); }
    const transactionType = key(proposal.transactionType);
    if (!transactionType) blockers.push("transaction_type_missing");
    else if (!new Set(["membership", "membershiprenewal", "membershiprecurring", "gymmembership"]).has(transactionType)) { blockers.push("transaction_type_not_membership"); routeViolations.push("transaction_type"); }
    const receivingEntity = proposal.legalEntityNumber.replace(/\D/g, "");
    if (!receivingEntity) blockers.push("membership_merchant_legal_entity_missing");
    else if (receivingEntity !== "17383077") { blockers.push("membership_merchant_legal_entity_mismatch"); routeViolations.push("legal_entity"); }
    if (routeViolations.length) blockers.push("FUTURE_ROUTING_VIOLATION");

    if (!/^cus_[A-Za-z0-9]+$/.test(proposal.customerId)) blockers.push("customer_reference_missing_or_invalid");
    if (!/^pm_[A-Za-z0-9]+$/.test(proposal.paymentMethodId)) blockers.push("payment_method_reference_missing_or_invalid");
    if (proposal.paymentMethodCustomerId !== proposal.customerId || !proposal.paymentMethodCustomerId) blockers.push("payment_method_customer_relationship_unverified");
    const amountMinor = /^\d+$/.test(proposal.amount) ? Number(proposal.amount) : NaN;
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) blockers.push("amount_invalid");
    const applicationFeeMinor = /^\d+$/.test(proposal.applicationFee) ? Number(proposal.applicationFee) : NaN;
    if (!Number.isSafeInteger(applicationFeeMinor) || applicationFeeMinor < 0 || (Number.isSafeInteger(amountMinor) && applicationFeeMinor > amountMinor)) blockers.push("application_fee_invalid_or_missing");
    const currency = proposal.currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) blockers.push("currency_invalid");
    const frequency = key(proposal.frequency);
    if (!new Set(["weekly", "monthly", "quarterly", "annual"]).has(frequency)) blockers.push("frequency_missing_or_unsupported");
    const due = validDate(proposal.nextDue);
    const paidThrough = validDate(proposal.paidThrough);
    if (!due) blockers.push("next_due_date_invalid");
    else if (due.getTime() > asOf.getTime()) blockers.push("not_due_yet");
    if (!paidThrough) blockers.push("paid_through_date_missing_or_invalid");
    else if (due && paidThrough.getTime() >= due.getTime()) blockers.push("payment_coverage_reaches_due_date");
    if (key(proposal.membershipStatus) !== "active") blockers.push("membership_not_active");
    if (key(proposal.authorityStatus) !== "active") blockers.push("payment_authority_not_active");
    if (!isYes(proposal.offSessionAuthorized) || !proposal.authorizationEvidence) blockers.push("off_session_authorization_not_evidenced");
    if (!new Set(["stopped", "cancelled", "canceled", "disabled"]).has(key(proposal.legacyScheduleStatus))) blockers.push("legacy_schedule_not_confirmed_stopped");
    if (new Set(["active", "ready", "pending"]).has(key(proposal.r12ArrangementStatus))) blockers.push("existing_r12_arrangement_may_collect");
    if (new Set(["upcoming", "due", "payment_pending", "retry_scheduled", "failed", "grace"]).has(key(proposal.r12ObligationStatus))) blockers.push("existing_r12_obligation_may_collect");
    if (new Set(["pending", "processing", "submitted", "paid", "succeeded", "in_progress", "failed", "retry_scheduled", "due", "overdue", "grace"]).has(key(proposal.collectionStatus))) blockers.push("collection_window_may_be_open_or_paid");
    if (new Set(["active", "ready", "pending", "processing", "submitted"]).has(key(proposal.otherProviderScheduleStatus))) blockers.push("other_provider_schedule_may_collect");

    const period = due ? due.toISOString().slice(0, 10) : proposal.nextDue;
    const collectionKey = `${identity}|${key(proposal.accountId)}|${period}`;
    if ((periodCounts.get(collectionKey) ?? 0) > 1) blockers.push("duplicate_collection_window");
    if ((crossScopeCounts.get(`${key(proposal.memberId)}|${period}`) ?? 0) > 1) blockers.push("cross_scope_duplicate_member_window");
    const idempotencyKey = await proposalIdempotencyKey([input.organisationId, "17383077", proposal.accountId, site ?? proposal.site, proposal.branchId, proposal.memberId, period, String(amountMinor), currency]);
    rows.push({ row: index + 2, site: proposal.site || "Unknown", amountMinor: Number.isSafeInteger(amountMinor) ? amountMinor : null, applicationFeeMinor: Number.isSafeInteger(applicationFeeMinor) && applicationFeeMinor >= 0 ? applicationFeeMinor : null, currency, frequency: proposal.frequency, dueAt: proposal.nextDue, idempotencyKey, ready: blockers.length === 0, blockers: [...new Set(blockers)] });
  }
  return { total: rows.length, ready: rows.filter(row => row.ready).length, blocked: rows.filter(row => !row.ready).length, errors, rows };
}

export function stripeBillingDryRunCsv(result: StripeBillingDryRun) {
  const quote = (input: unknown) => `"${String(input ?? "").replaceAll('"', '""')}"`;
  const headings = ["source_row", "site", "readiness", "amount_minor", "application_fee_minor", "currency", "frequency", "due_at", "idempotency_key", "blockers"];
  return [headings, ...result.rows.map(row => [row.row, row.site, row.ready ? "dry_run_ready_not_enabled" : "blocked", row.amountMinor, row.applicationFeeMinor, row.currency, row.frequency, row.dueAt, row.idempotencyKey, row.blockers.join(";")])].map(line => line.map(quote).join(",")).join("\n");
}
