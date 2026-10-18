import { parseCsvRecords } from "./club-csv";

export type ReconciliationSourceKind = "membership" | "stripe" | "gocardless";
export type ReconciliationSource = {
  id: string;
  kind: ReconciliationSourceKind;
  site: string;
  merchantAccount: string;
  stripeLegacyAccountLabel: string;
  merchantLegalEntityNumber: string;
  fileName: string;
  csv: string;
};

type MembershipRecord = {
  site: string; branchId: string; memberId: string; email: string; row: number;
  fields: Record<string, string>;
};
type ProviderRecord = {
  kind: "stripe" | "gocardless"; site: string; account: string; legalEntityNumber: string; customerId: string;
  memberId: string; branchId: string; email: string; mandateId: string; subscriptionId: string;
  legacyArrangementReference: string; legacyScheduleStatus: string;
  mandateState: "active" | "cancelled" | "unknown"; paymentReference: string;
  row: number; fields: Record<string, string>;
};
export type ReconciliationIssue = {
  source: string; site: string; account: string; row: number;
  kind: string; severity: "review" | "unmatched" | "conflict";
  code?: "LEGACY_ACCOUNT_EXCEPTION" | "FUTURE_ROUTING_VIOLATION";
  memberId: string; branchId: string; providerId: string;
};
export type PaymentReconciliationPreview = {
  summary: {
    membershipRows: number; providerRows: number; exactIdentityMatches: number;
    emailOnlyOverlaps: number; stripeRows: number; goCardlessRows: number;
    activeMandates: number; cancelledMandates: number; unknownMandateState: number;
    paymentEvidenceRows: number; duplicateCustomerRecords: number; legacyAccountExceptions: number;
  };
  missingScheduleFields: Record<string, number>;
  sourceSchemas: Array<{ source: string; unsupportedHeaders: string[]; missingRequiredFields: string[] }>;
  issues: ReconciliationIssue[];
  errors: string[];
};

const clean = (value: unknown) => String(value ?? "").trim();
const norm = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en-GB");
const headerKey = (value: string) => norm(value).replace(/[^a-z0-9]/g, "");
const compactId = (value: string) => value ? `…${value.slice(-4)}` : "";
const aliases = {
  memberId: ["memberid", "clubmanagermemberid", "legacyreferenc", "legacyreference", "membernumber", "memberno", "memberidmetadata", "metadata.memberid", "metadata_memberid", "customermetadata_memberid", "clubmanager member id"],
  branchId: ["branchid", "clubmanagerbranchid", "branchidmetadata", "metadata.branchid", "metadata_branchid", "customermetadata_branchid", "clubmanager branch id"],
  email: ["email", "emailaddress", "customeremail", "email address"],
  customerId: ["customerid", "id", "customernumber", "customer id", "customer reference"],
  mandateId: ["mandateid", "mandate", "gocardlessmandateid", "mandatereference", "mandate id"],
  subscriptionId: ["subscriptionid", "stripe_subscription_id", "provider_subscription_id", "subscription id"],
  mandateState: ["mandateactive", "mandatestatus", "mandate_state", "mandate status", "active mandate"],
    paymentReference: ["paymentid", "paymentreference", "lastpaymentid", "providerpaymentid", "payment id", "payment reference", "collection id"],
  legacyArrangementReference: ["legacyarrangementreference", "billingarrangementid", "recurringarrangementid", "paymentscheduleid", "scheduleid", "recurringpaymentreference", "legacybillingreference"],
  legacyScheduleStatus: ["legacyschedulestatus", "schedulestatus", "recurringstatus", "billingstatus", "paymentplanstatus", "recurringpaymentstatus"],
  amount: ["amount", "amountminor", "recurringamount", "subscriptionamount", "membershipamount", "price", "fee", "amount due"],
  frequency: ["frequency", "billingfrequency", "interval", "paymentfrequency", "billing frequency"],
  nextDue: ["nextduedate", "nextpaymentdate", "nextcollectiondate", "nextduedatetime", "next due date", "next payment date"],
  paidThrough: ["paidthrough", "paidthroughdate", "coverageenddate", "paiduntil", "paid through date", "paid until"],
  collectionStatus: ["collectionstatus", "paymentstatus", "lastpaymentstatus", "subscriptionstatus", "collection status", "last collection status"],
} as const;

const semanticAliases: Record<string, readonly string[]> = aliases;
const commonProviderHeaders = new Set([
  "id", "created", "createdat", "description", "name", "currency", "livemode", "object", "metadata",
  "customermetadata", "address", "phone", "city", "country", "postalcode", "state", "currencycode",
]);
function schemaFor(source: ReconciliationSource, headers: string[]) {
  const normalized = headers.map(headerKey);
  const supports = (semantic: keyof typeof aliases) => normalized.some(header =>
    aliases[semantic].some(alias => {
      const wanted = headerKey(alias);
      return header === wanted || header.endsWith(wanted);
    }) || (semantic === "memberId" || semantic === "branchId") && normalized.includes("metadata")
  );
  const required = source.kind === "membership" ? ["memberId", "branchId"] : ["customerId", "memberId", "branchId"];
  const fieldLabels: Record<string, string> = { memberId: "Club Manager MemberId", branchId: "Club Manager BranchId", customerId: "provider customer ID" };
  const missingRequiredFields = required.filter(field => !supports(field as keyof typeof aliases)).map(field => fieldLabels[field]);
  const unsupportedHeaders = headers.filter(header => {
    const normalizedHeader = headerKey(header);
    return !Object.values(semanticAliases).some(names => names.some(alias => normalizedHeader === headerKey(alias) || normalizedHeader.endsWith(headerKey(alias))))
      && !(source.kind !== "membership" && commonProviderHeaders.has(normalizedHeader));
  });
  return { source: source.fileName || source.kind, unsupportedHeaders, missingRequiredFields };
}

function read(row: Record<string, string>, names: readonly string[]): string {
  const entries = Object.entries(row).map(([key, value]) => [headerKey(key), clean(value)] as const);
  for (const name of names) {
    const key = headerKey(name);
    const direct = entries.find(([candidate]) => candidate === key)?.[1];
    if (direct) return direct;
  }
  const metadata = entries.find(([key]) => key === "metadata" || key === "customermetadata")?.[1];
  if (metadata) {
    try {
      const value = JSON.parse(metadata) as Record<string, unknown>;
      const wanted = new Set(names.map(headerKey));
      const found = Object.entries(value).find(([key]) => wanted.has(headerKey(key)));
      if (found) return clean(found[1]);
    } catch { /* Provider exports often flatten metadata into columns. */ }
  }
  // Support exported metadata columns with arbitrary prefixes such as `Metadata: MemberId`.
  for (const name of names) {
    const wanted = headerKey(name);
    const match = entries.find(([candidate, value]) => value && candidate.endsWith(wanted));
    if (match) return match[1];
  }
  return "";
}

function isActive(value: string): "active" | "cancelled" | "unknown" {
  const state = norm(value).replace(/[\s-]+/g, "_");
  if (["active", "true", "yes", "1", "confirmed", "submitted", "pending_submission"].includes(state)) return "active";
  if (["cancelled", "canceled", "false", "no", "0", "expired", "failed", "inactive", "terminated", "replaced"].includes(state)) return "cancelled";
  return "unknown";
}

function safeParse(source: ReconciliationSource, errors: string[]) {
  try { return parseCsvRecords(source.csv, true); }
  catch { errors.push(`${source.fileName || source.kind}: CSV format is invalid.`); return []; }
}

function stripeOwnerFromLegacyLabel(label: string): "17383077" | "17383213" | "" {
  const normalized = norm(label);
  if (normalized === "rotherham") return "17383077";
  if (normalized === "carlton") return "17383213";
  return "";
}

export function buildLegacyPaymentReconciliationPreview(organisationId: string, sources: ReconciliationSource[]): PaymentReconciliationPreview {
  const errors: string[] = [];
  if (!clean(organisationId)) errors.push("An organisation context is required.");
  const membership: MembershipRecord[] = [];
  const providers: ProviderRecord[] = [];
  const sourceSchemas: PaymentReconciliationPreview["sourceSchemas"] = [];
  const seenSourceIds = new Set<string>();
  for (const source of sources) {
    if (seenSourceIds.has(source.id)) { errors.push("A source file was included more than once."); continue; }
    seenSourceIds.add(source.id);
    if (!source.site.trim() || !["rotherham", "carlton"].includes(norm(source.site))) errors.push(`${source.fileName || source.kind}: select Rotherham or Carlton.`);
    if (source.kind !== "membership" && !source.merchantAccount.trim()) errors.push(`${source.fileName || source.kind}: enter the explicit merchant account label.`);
    const stripeOwner = source.kind === "stripe" ? stripeOwnerFromLegacyLabel(source.stripeLegacyAccountLabel) : "";
    if (source.kind === "stripe" && !stripeOwner) errors.push(`${source.fileName || source.kind}: select the historical Stripe account label (Rotherham or Carlton) so its confirmed legal owner is applied.`);
    if (source.kind === "stripe" && stripeOwner && source.merchantLegalEntityNumber.replace(/\D/g, "") !== stripeOwner) errors.push(`${source.fileName || source.kind}: legal-entity mapping conflicts with the historical Stripe account label.`);
    if (source.kind === "gocardless" && source.merchantLegalEntityNumber.replace(/\D/g, "") !== "17383077") errors.push(`${source.fileName || source.kind}: GoCardless membership provenance must be Madhouse Franchise Limited (17383077).`);
    const parsedRows = safeParse(source, errors);
    if (parsedRows.length) sourceSchemas.push(schemaFor(source, Object.keys(parsedRows[0])));
    else if (source.csv.trim()) sourceSchemas.push({ source: source.fileName || source.kind, unsupportedHeaders: [], missingRequiredFields: [] });
    for (const [index, row] of parsedRows.entries()) {
      const rowNumber = index + 2;
      const memberId = read(row, aliases.memberId);
      const branchId = read(row, aliases.branchId);
      const email = norm(read(row, aliases.email));
      if (source.kind === "membership") {
        membership.push({ site: source.site.trim(), branchId, memberId, email, row: rowNumber, fields: row });
      } else {
        providers.push({
          kind: source.kind, site: source.site.trim(), account: source.merchantAccount.trim(), legalEntityNumber: stripeOwner || source.merchantLegalEntityNumber.replace(/\D/g, ""),
          customerId: read(row, aliases.customerId), memberId, branchId, email,
          mandateId: read(row, aliases.mandateId), subscriptionId: read(row, aliases.subscriptionId), mandateState: isActive(read(row, aliases.mandateState)),
          legacyArrangementReference: read(row, aliases.legacyArrangementReference), legacyScheduleStatus: read(row, aliases.legacyScheduleStatus),
          paymentReference: read(row, aliases.paymentReference), row: rowNumber, fields: row,
        });
      }
    }
  }

  const goCardlessProvenanceBySite = new Map<string, Set<string>>();
  for (const source of sources.filter(source => source.kind !== "membership" && source.merchantAccount.trim())) {
    const siteKey = norm(source.site);
    if (source.kind === "gocardless") goCardlessProvenanceBySite.set(siteKey, new Set([...(goCardlessProvenanceBySite.get(siteKey) ?? []), norm(source.merchantAccount)]));
  }
  const goCardlessAccounts = [...goCardlessProvenanceBySite.values()].flatMap(accounts => [...accounts]);
  if (goCardlessProvenanceBySite.has("rotherham") && goCardlessProvenanceBySite.has("carlton") && new Set(goCardlessAccounts).size < 2) {
    errors.push("Rotherham and Carlton GoCardless exports must retain distinct historical creditor/account provenance.");
  }

  const issues: ReconciliationIssue[] = [];
  const addIssue = (kind: string, severity: ReconciliationIssue["severity"], record: { site: string; branchId: string; memberId: string; row: number }, source: string, account = "", providerId = "", code?: ReconciliationIssue["code"]) => issues.push({ source, site: record.site, account, row: record.row, kind, severity, code, memberId: compactId(record.memberId), branchId: compactId(record.branchId), providerId: compactId(providerId) });
  const membershipKey = (r: { site: string; branchId: string; memberId: string }) => `${norm(r.site)}|${norm(r.branchId)}|${norm(r.memberId)}`;
  const strictMembership = new Map<string, MembershipRecord[]>();
  const bySiteMember = new Map<string, MembershipRecord[]>();
  const byMemberId = new Map<string, MembershipRecord[]>();
  const emails = new Map<string, MembershipRecord[]>();
  for (const record of membership) {
    if (!record.memberId) addIssue("Membership row missing MemberId", "unmatched", record, "membership");
    if (!record.branchId) addIssue("Membership row missing BranchId; source link cannot be confirmed", "review", record, "membership");
    if (record.memberId && record.branchId) strictMembership.set(membershipKey(record), [...(strictMembership.get(membershipKey(record)) ?? []), record]);
    if (record.memberId) bySiteMember.set(`${norm(record.site)}|${norm(record.memberId)}`, [...(bySiteMember.get(`${norm(record.site)}|${norm(record.memberId)}`) ?? []), record]);
    if (record.memberId) byMemberId.set(norm(record.memberId), [...(byMemberId.get(norm(record.memberId)) ?? []), record]);
    if (record.email) emails.set(record.email, [...(emails.get(record.email) ?? []), record]);
  }
  for (const matches of strictMembership.values()) if (matches.length > 1) for (const row of matches) addIssue("Duplicate membership source reference within site and branch", "conflict", row, "membership");
  for (const matches of emails.values()) if (matches.length > 1) for (const row of matches) addIssue("Email appears on multiple membership rows; not used as a payment link", "review", row, "membership");
  for (const matches of byMemberId.values()) if (new Set(matches.map(row => norm(row.site))).size > 1) for (const row of matches) addIssue("MemberId appears across sites; keep branch/site identity separate and review overlap", "review", row, "membership");
  for (const matches of bySiteMember.values()) if (new Set(matches.map(row => norm(row.branchId)).filter(Boolean)).size > 1) for (const row of matches) addIssue("MemberId repeats across branches; keep branch identity separate", "review", row, "membership");

  const providerCustomerKeys = new Map<string, ProviderRecord[]>();
  const providerIdentityKeys = new Map<string, ProviderRecord[]>();
  const providerEmailKeys = new Map<string, ProviderRecord[]>();
  let exactIdentityMatches = 0;
  let emailOnlyOverlaps = 0;
  let paymentEvidenceRows = 0;
  for (const record of providers) {
    const source = record.kind;
    if (!record.customerId) addIssue("Provider customer identifier missing", "unmatched", record, source, record.account);
    if (!record.memberId) addIssue("Club Manager MemberId metadata missing; customer cannot be linked by email alone", "unmatched", record, source, record.account, record.customerId);
    if (!record.branchId) addIssue("BranchId metadata missing; source link cannot be confirmed", "review", record, source, record.account, record.customerId);
    if (!record.account) addIssue("Merchant account provenance missing", "unmatched", record, source, "", record.customerId);
    if (!record.legalEntityNumber) addIssue("Merchant legal-entity provenance missing", "unmatched", record, source, record.account, record.customerId);
    if (record.paymentReference) paymentEvidenceRows += 1;
    const customerKey = `${source}|${norm(record.account)}|${norm(record.customerId)}`;
    if (record.customerId) providerCustomerKeys.set(customerKey, [...(providerCustomerKeys.get(customerKey) ?? []), record]);
    if (record.email) {
      const emailKey = `${source}|${norm(record.account)}|${record.email}`;
      providerEmailKeys.set(emailKey, [...(providerEmailKeys.get(emailKey) ?? []), record]);
    }
    if (record.memberId) {
      const identityKey = `${source}|${norm(record.account)}|${membershipKey(record)}`;
      providerIdentityKeys.set(identityKey, [...(providerIdentityKeys.get(identityKey) ?? []), record]);
      const matches = record.branchId ? strictMembership.get(membershipKey(record)) ?? [] : bySiteMember.get(`${norm(record.site)}|${norm(record.memberId)}`) ?? [];
      if (matches.length === 1 && record.site.trim() && record.account && record.branchId && matches[0].branchId) {
        // This is only an identity-key match, never proof of active membership or reusable payment authority.
        exactIdentityMatches += 1;
        if (record.kind === "stripe" && record.legalEntityNumber === "17383213") {
          const membershipRecord = matches[0];
          const arrangementReference = record.legacyArrangementReference || read(membershipRecord.fields, aliases.legacyArrangementReference);
          if (arrangementReference) {
            addIssue("LEGACY_ACCOUNT_EXCEPTION: explicit legacy membership arrangement is associated with the MPS Stripe account. Preserve its account and references; review before any separately authorised cutover.", "review", record, source, record.account, record.customerId, "LEGACY_ACCOUNT_EXCEPTION");
          } else {
            addIssue("Stripe customer identity match only; it does not establish an active membership, recurring arrangement, successful historic charge, or reusable payment authority.", "review", record, source, record.account, record.customerId);
          }
        }
      }
      else if (matches.length > 1) addIssue("MemberId maps to multiple rows; branch/account review required", "conflict", record, source, record.account, record.customerId);
      else if (record.branchId && (bySiteMember.get(`${norm(record.site)}|${norm(record.memberId)}`)?.length ?? 0) > 0) addIssue("MemberId found but BranchId differs; not linked", "conflict", record, source, record.account, record.customerId);
      else addIssue("No membership source row matches this provider record", "unmatched", record, source, record.account, record.customerId);
    } else if (record.email && (emails.get(record.email)?.length ?? 0) > 0) {
      emailOnlyOverlaps += 1;
      addIssue("Email overlap only; not a confirmed provider relationship", "review", record, source, record.account, record.customerId);
    } else addIssue("Provider row has no usable Club Manager source identity", "unmatched", record, source, record.account, record.customerId);
  }
  for (const matches of providerCustomerKeys.values()) if (matches.length > 1) for (const row of matches) addIssue("Duplicate provider customer row within the same merchant account", "conflict", row, row.kind, row.account, row.customerId);
  for (const matches of providerEmailKeys.values()) if (matches.length > 1) for (const row of matches) addIssue("Email repeats among customers in the same provider account; not used as a link", "review", row, row.kind, row.account, row.customerId);
  for (const matches of providerIdentityKeys.values()) {
    const customerIds = new Set(matches.map(row => row.customerId).filter(Boolean));
    if (customerIds.size > 1) for (const row of matches) addIssue("Multiple provider customers claim the same source member identity", "conflict", row, row.kind, row.account, row.customerId);
  }
  const linkedSourceKeys = new Set(providers.filter(row => row.memberId && row.branchId && row.account).map(row => membershipKey(row)));
  for (const sourceKey of linkedSourceKeys) {
    const stripe = providers.some(row => row.kind === "stripe" && row.branchId && membershipKey(row) === sourceKey);
    const goCardless = providers.some(row => row.kind === "gocardless" && row.branchId && membershipKey(row) === sourceKey);
    if (stripe && goCardless) {
      const row = providers.find(value => membershipKey(value) === sourceKey)!;
      addIssue("Source identity appears in both Stripe and GoCardless exports; review separate roles/statuses", "review", row, "cross-provider", "", "");
    }
  }

  const scheduleFields = ["amount", "frequency", "next due date", "paid-through date", "collection status"] as const;
  const missingScheduleFields: Record<string, number> = Object.fromEntries(scheduleFields.map(field => [field, 0]));
  for (const member of membership) {
    const linked = providers.filter(provider => provider.memberId && provider.branchId && membershipKey(provider) === membershipKey(member) && provider.account);
    const allRows: Record<string, string>[] = [member.fields, ...linked.map(row => row.fields)];
    const scheduleAliases = [aliases.amount, aliases.frequency, aliases.nextDue, aliases.paidThrough, aliases.collectionStatus] as const;
    scheduleAliases.forEach((keys, index) => { if (!allRows.some(row => read(row, keys))) missingScheduleFields[scheduleFields[index]] += 1; });
  }
  const goCardlessMandates = providers.filter(row => row.kind === "gocardless");
  const mandateCounts = { active: goCardlessMandates.filter(row => row.mandateState === "active").length, cancelled: goCardlessMandates.filter(row => row.mandateState === "cancelled").length, unknown: goCardlessMandates.filter(row => row.mandateState === "unknown").length };
  return {
    summary: {
      membershipRows: membership.length, providerRows: providers.length, exactIdentityMatches,
      emailOnlyOverlaps, stripeRows: providers.filter(row => row.kind === "stripe").length,
      goCardlessRows: providers.filter(row => row.kind === "gocardless").length,
      activeMandates: mandateCounts.active, cancelledMandates: mandateCounts.cancelled,
      unknownMandateState: mandateCounts.unknown, paymentEvidenceRows,
      duplicateCustomerRecords: [...providerCustomerKeys.values()].filter(rows => rows.length > 1).reduce((sum, rows) => sum + rows.length, 0),
      legacyAccountExceptions: issues.filter(issue => issue.code === "LEGACY_ACCOUNT_EXCEPTION").length,
    },
    missingScheduleFields, sourceSchemas, issues, errors,
  };
}

export function reconciliationIssuesCsv(preview: PaymentReconciliationPreview) {
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = [["source", "site", "merchant_account", "source_row", "classification", "issue", "severity", "member_id_suffix", "branch_id_suffix", "provider_id_suffix"], ...preview.issues.map(issue => [issue.source, issue.site, issue.account, issue.row, issue.code ?? "", issue.kind, issue.severity, issue.memberId, issue.branchId, issue.providerId])];
  return rows.map(row => row.map(quote).join(",")).join("\n");
}
