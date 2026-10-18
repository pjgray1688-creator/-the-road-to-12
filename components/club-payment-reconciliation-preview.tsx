"use client";

import { useMemo, useState } from "react";
import { buildLegacyPaymentReconciliationPreview, reconciliationIssuesCsv, type ReconciliationSource, type ReconciliationSourceKind } from "@/lib/legacy-payment-reconciliation";
import { stripeBillingDryRunCsv, validateLegacyStripeBillingDryRun, type StripeBillingDryRun, type StripeMerchantMappings } from "@/lib/legacy-stripe-billing-dry-run";

type DraftSource = ReconciliationSource & { csv: string };
const initialSource = (): DraftSource => ({ id: "export-1", kind: "membership", site: "", merchantAccount: "", stripeLegacyAccountLabel: "", merchantLegalEntityNumber: "", fileName: "", csv: "" });

export function ClubPaymentReconciliationPreview({ organisationId }: { organisationId: string }) {
  const [sources, setSources] = useState<DraftSource[]>([initialSource()]);
  const [proposalCsv, setProposalCsv] = useState("");
  const [proposalFile, setProposalFile] = useState("");
  const [merchantMappings, setMerchantMappings] = useState<StripeMerchantMappings>({ franchiseMembershipAccountId: "" });
  const [dryRun, setDryRun] = useState<StripeBillingDryRun | null>(null);
  const [dryRunError, setDryRunError] = useState("");
  const preview = useMemo(() => buildLegacyPaymentReconciliationPreview(organisationId, sources.filter(source => source.csv)), [organisationId, sources]);
  const update = (id: string, values: Partial<DraftSource>) => setSources(current => current.map(source => source.id === id ? { ...source, ...values } : source));
  const download = () => {
    const url = URL.createObjectURL(new Blob([reconciliationIssuesCsv(preview)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "madhouse-payment-reconciliation-discrepancies.csv"; anchor.click(); URL.revokeObjectURL(url);
  };
  const runStripeDryRun = async () => {
    setDryRun(null); setDryRunError("");
    try {
      const membershipCsvs = sources.filter(source => source.kind === "membership" && source.csv).map(source => ({ site: source.site, csv: source.csv }));
      setDryRun(await validateLegacyStripeBillingDryRun({ organisationId, membershipCsvs, proposalsCsv: proposalCsv, merchantMappings }));
    } catch { setDryRunError("The local Stripe schedule preview could not be completed. Check the CSV format and try again."); }
  };
  const downloadDryRun = () => {
    if (!dryRun) return;
    const url = URL.createObjectURL(new Blob([stripeBillingDryRunCsv(dryRun)], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "stripe-recurring-charge-dry-run.csv"; anchor.click(); URL.revokeObjectURL(url);
  };
  return <details className="card" aria-label="Legacy payment reconciliation preview">
    <summary><strong>Legacy payment reconciliation · read-only preview</strong></summary>
    <p className="muted">Compare Club Manager membership exports with Stripe and GoCardless customer exports before planning a billing transition. Files are parsed in this browser only; nothing is uploaded, saved, linked to members, or sent to either provider.</p>
    <p className="muted">Use six rows for the six exports: Club Manager, Stripe and GoCardless for each site. Site and BranchId remain separate identity/operations data. The historical Stripe account label “Rotherham” maps to Madhouse Franchise Limited (17383077); “Carlton” maps to Madhouse Products and Services Limited (17383213). The label identifies the legacy merchant, not the gym/location field. Franchise is the required merchant for all future memberships; MPS is for future shop, Glow Zone, PT and other non-membership sales. GoCardless uses Franchise-owned accounts with separate historical Rotherham/Carlton creditor provenance. Account IDs are not credentials. Do not enter API keys or bank details.</p>
    <div className="club-catalogue-list">
      {sources.map((source, index) => <article className="club-catalogue-row" key={source.id}>
        <div className="catalogue-import-mapping">
          <label>Export type<select value={source.kind} onChange={event => { const kind = event.target.value as ReconciliationSourceKind; update(source.id, { kind, merchantAccount: kind === "membership" ? "" : source.merchantAccount, stripeLegacyAccountLabel: "", merchantLegalEntityNumber: kind === "gocardless" ? "17383077" : "" }); }}><option value="membership">Club Manager membership</option><option value="stripe">Stripe customers</option><option value="gocardless">GoCardless customers</option></select></label>
          <label>Site<select value={source.site} onChange={event => update(source.id, { site: event.target.value })}><option value="">Select site</option><option value="Rotherham">Rotherham</option><option value="Carlton">Carlton</option></select></label>
          {source.kind === "stripe" ? <>
            <label>Historical Stripe account label<select value={source.stripeLegacyAccountLabel} onChange={event => update(source.id, { stripeLegacyAccountLabel: event.target.value, merchantLegalEntityNumber: event.target.value === "Rotherham" ? "17383077" : event.target.value === "Carlton" ? "17383213" : "" })}><option value="">Select legacy account label</option><option value="Rotherham">Rotherham · Madhouse Franchise Limited · 17383077</option><option value="Carlton">Carlton · Madhouse Products and Services Limited · 17383213</option></select></label>
            <label>Actual Stripe account ID / provenance<input value={source.merchantAccount} onChange={event => update(source.id, { merchantAccount: event.target.value })} placeholder="acct_… or exact source account label"/></label>
          </> : null}
          {source.kind === "gocardless" ? <>
            <p className="muted">Merchant: Madhouse Franchise Limited · 17383077</p>
            <label>{source.site || "Site-specific"} historical GoCardless creditor/account ID<input value={source.merchantAccount} onChange={event => update(source.id, { merchantAccount: event.target.value })} placeholder="Creditor/account ID or exact provenance label"/></label>
          </> : null}
        </div>
        <label>{source.kind === "membership" ? "Membership export CSV" : `${source.kind === "stripe" ? "Stripe" : "GoCardless"} customer export CSV`}<input type="file" accept=".csv,text/csv" onChange={event => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(csv => update(source.id, { csv, fileName: file.name })); }}/></label>
        {source.fileName ? <small>{source.fileName} · held in this page’s memory only</small> : null}
        {sources.length > 1 ? <button type="button" className="secondary" onClick={() => setSources(current => current.filter(item => item.id !== source.id))}>Remove export</button> : null}
      </article>)}
    </div>
    <button type="button" className="secondary" onClick={() => setSources(current => [...current, { ...initialSource(), id: `export-${crypto.randomUUID()}` }])}>Add another export</button>
    {preview.errors.length ? <div role="alert" className="error-text">{preview.errors.map(error => <p key={error}>{error}</p>)}</div> : null}
    {preview.sourceSchemas.map(schema => <section className="muted" key={schema.source} aria-label={`CSV schema review for ${schema.source}`}><strong>{schema.source} · header review</strong>{schema.missingRequiredFields.length ? <p role="alert">Required fields not recognised: {schema.missingRequiredFields.join(", ")}. Rows are retained where possible and incomplete identity is flagged below.</p> : <p>Required identity headers recognised.</p>}{schema.unsupportedHeaders.length ? <p>Unrecognised headers (not used for matching): {schema.unsupportedHeaders.join(", ")}</p> : null}</section>)}
    {preview.summary.membershipRows || preview.summary.providerRows ? <>
      <h3>Reconciliation overview</h3>
      <dl className="club-detail-grid">
        <div><dt>Membership rows</dt><dd>{preview.summary.membershipRows}</dd></div>
        <div><dt>Provider customer rows</dt><dd>{preview.summary.providerRows} · Stripe {preview.summary.stripeRows} / GoCardless {preview.summary.goCardlessRows}</dd></div>
        <div><dt>Exact identity matches</dt><dd>{preview.summary.exactIdentityMatches}</dd></div>
        <div><dt>Legacy account exceptions</dt><dd>{preview.summary.legacyAccountExceptions} · review only; never auto-moved</dd></div>
        <div><dt>Email-only overlaps</dt><dd>{preview.summary.emailOnlyOverlaps} · never treated as linked</dd></div>
        <div><dt>Mandate state</dt><dd>{preview.summary.activeMandates} active · {preview.summary.cancelledMandates} cancelled · {preview.summary.unknownMandateState} unknown</dd></div>
        <div><dt>Rows with payment reference</dt><dd>{preview.summary.paymentEvidenceRows} · reference presence only, not proof a charge succeeded</dd></div>
        <div><dt>Duplicate provider customer rows</dt><dd>{preview.summary.duplicateCustomerRecords}</dd></div>
      </dl>
      <p className="muted">“Exact source links” means an identity-key match only, not proof of an active membership, recurring authority, reusable payment method or successful collection. A customer row or historic payment reference alone proves none of those. Existing MPS-associated membership arrangements are review-only legacy exceptions; their merchant and source references are preserved.</p>
      <h3>Billing schedule fields missing from membership rows</h3>
      <p className="muted">{Object.entries(preview.missingScheduleFields).map(([field, count]) => `${field}: ${count}`).join(" · ")}</p>
      <h3>Discrepancies</h3>
      <p>{preview.issues.length} review items · identifiers are masked; names and email addresses are not shown or exported.</p>
      {preview.issues.length ? <>
        <button type="button" className="secondary" onClick={download}>Download discrepancy report</button>
        <div className="club-catalogue-list">{preview.issues.slice(0, 30).map((issue, index) => <article className="club-catalogue-row" key={`${issue.source}-${issue.row}-${issue.kind}-${index}`}><div><strong>{issue.kind}</strong><small>{issue.source} · {issue.site || "Site missing"} · row {issue.row}{issue.account ? ` · ${issue.account}` : ""}</small></div><span className={issue.severity === "conflict" ? "error-text" : "muted"}>{[issue.memberId && `Member ${issue.memberId}`, issue.branchId && `Branch ${issue.branchId}`, issue.providerId && `ID ${issue.providerId}`].filter(Boolean).join(" · ") || issue.severity}</span></article>)}</div>
        {preview.issues.length > 30 ? <p className="muted">Showing first 30. The CSV includes all discrepancy rows.</p> : null}
      </> : <p className="muted">No discrepancies detected by these source-key checks. This is not approval to change billing.</p>}
    </> : null}
    <p className="muted">This preview does not call any R12 import, billing, entitlement, Stripe or GoCardless endpoint.</p>
    <hr />
    <h3>Stripe recurring charge validation · disabled dry-run</h3>
    <p className="muted">Validate a proposed off-session schedule locally before any future cutover review. This does not save customer/payment-method references or create a charge. Do not include card numbers, CVCs, bank details, API keys or other credentials. Only Stripe IDs (cus_ / pm_) are accepted as opaque references.</p>
    <div className="catalogue-import-mapping">
      <label>Expected Franchise membership Stripe account ID · company 17383077<input value={merchantMappings.franchiseMembershipAccountId ?? ""} onChange={event => setMerchantMappings({ franchiseMembershipAccountId: event.target.value })} autoComplete="off" placeholder="acct_…" /></label>
    </div>
    <p className="muted">The same Franchise account is expected for Rotherham and Carlton membership proposals; site and BranchId do not select a Stripe merchant. MPS (17383213) is not a membership merchant. These local values are operator-supplied comparisons only; ownership is not verified against Stripe. A production mapping must be approved and held server-side before this disabled preview could ever be enabled.</p>
    <label>Proposed Stripe schedule CSV<input type="file" accept=".csv,text/csv" onChange={event => { const file = event.target.files?.[0]; if (!file) return; void file.text().then(csv => { setProposalCsv(csv); setProposalFile(file.name); setDryRun(null); }); }} /></label>
    {proposalFile ? <small>{proposalFile} · held in this page’s memory only</small> : null}
    <p className="muted">Required columns: Transaction Type (membership), Receiving Legal Entity Number (17383077), Site, BranchId, MemberId, Stripe Account ID, Stripe Customer Account ID, Stripe Customer ID, Stripe Payment Method Account ID, Stripe Payment Method ID, Payment Method Customer ID, Amount Minor, Application Fee Minor (use 0 only if separately approved), Currency, Frequency, Next Due At, Paid Through At, Membership Status, Payment Method Status, Off Session Authorized, Authorization Evidence Reference, Legacy Schedule Status, R12 Arrangement Status, R12 Obligation Status, Collection Status. Optional: Other Provider Schedule Status. All three account IDs must match the approved Franchise account. The proposal is still validation-only and cannot create a payment.</p>
    <button type="button" className="secondary" disabled={!proposalCsv} onClick={() => void runStripeDryRun()}>Validate proposed schedule locally</button>
    {dryRunError ? <p role="alert" className="error-text">{dryRunError}</p> : null}
    {dryRun ? <>
      <h4>Dry-run result</h4>
      <p>{dryRun.total} rows · {dryRun.ready} pass validation · {dryRun.blocked} blocked. A passing row is not authorization to charge; recurring Stripe collection remains disabled.</p>
      {dryRun.errors.map(error => <p role="alert" className="error-text" key={error}>{error}</p>)}
      <button type="button" className="secondary" onClick={downloadDryRun}>Download masked validation report</button>
      <div className="club-catalogue-list">{dryRun.rows.slice(0, 50).map(row => <article className="club-catalogue-row" key={`${row.row}-${row.idempotencyKey}`}><div><strong>Row {row.row} · {row.site}</strong><small>{row.amountMinor === null ? "Amount invalid" : `${row.currency} ${(row.amountMinor / 100).toFixed(2)}`} · application fee {row.applicationFeeMinor === null ? "missing/invalid" : `${row.currency} ${(row.applicationFeeMinor / 100).toFixed(2)}`} · {row.frequency || "frequency missing"} · {row.dueAt || "due date missing"}</small></div><span className={row.ready ? "muted" : "error-text"}>{row.ready ? "Validation passed · not charged" : row.blockers.join(" · ")}</span></article>)}</div>
      {dryRun.rows.length > 50 ? <p className="muted">Showing first 50 rows; the downloaded report includes all rows. Provider references are never included.</p> : null}
    </> : null}
    <p className="muted">No payment is submitted. There is no Stripe API call, outbox entry, billing arrangement, obligation, entitlement change or activation path in this preview.</p>
  </details>;
}
