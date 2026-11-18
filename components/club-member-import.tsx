"use client";

import { useEffect, useState, useTransition } from "react";
import { authoriseMemberImportAction, executeMemberImportAction, getApprovedMemberImportRecoveryStatusAction, getMemberImportBatchAction, mapMemberImportPackageAction, recoverApprovedMemberImportBatchAction, stageMemberImportAction } from "@/app/club/members/import/actions";
import { stageMemberCsv, type MemberImportMapping } from "@/lib/club-member-import";

const fields: Array<[string, string]> = [["firstName", "First name"], ["lastName", "Last name"], ["fullName", "Full name"], ["email", "Email"], ["phone", "Phone"], ["legacyReference", "External member ID"], ["membershipName", "Membership/package"], ["membershipStatus", "Membership status"], ["startDate", "Start date"], ["endDate", "End/expiry date"], ["nextPaymentDate", "Next payment date"], ["paidThroughDate", "Paid-through date"], ["homeLocation", "Home location"], ["billingMethod", "Payment method"], ["householdReference", "Shared contract ID"], ["householdRole", "Covered person role"], ["responsiblePayerReference", "Responsible payer member ID"], ["billingAmount", "Recurring amount"], ["providerCustomerReference", "Provider customer reference"], ["providerSubscriptionReference", "Mandate/subscription reference"]];
type ServerRow = { source_row_number?: number; normalized_values?: Record<string, string>; warnings?: string[]; blockers?: string[]; action?: string; outcome?: string };
type RecoverySummary = { state: "eligible" | "completed" | "not_eligible"; total: number; imported: number; linked: number; recovered: number; skipped: number | null; rejected: number; failed: number | null; memberships: number };
export function ClubMemberImport({ organisationId, membershipProducts = [] }: { organisationId: string; membershipProducts?: Array<{ id: string; name: string; isLifetime?: boolean; legacyImportCategory?: string; archived?: boolean; fixedTermValue?: number; fixedTermUnit?: "day" | "week" | "month" }> }) {
  const [filename, setFilename] = useState("");
  const [source, setSource] = useState("");
  const [mapping, setMapping] = useState<MemberImportMapping>({});
  const [preview, setPreview] = useState<ReturnType<typeof stageMemberCsv>>();
  const [batch, setBatch] = useState<Record<string, unknown>>({});
  const [serverRows, setServerRows] = useState<ServerRow[]>([]);
  const [message, setMessage] = useState("");
  const [recoverySummary, setRecoverySummary] = useState<RecoverySummary | null>(null);
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(true);
  const [recoveryAttempted, setRecoveryAttempted] = useState(false);
  const [pending, startTransition] = useTransition();
  const batchId = String(batch.id ?? "");

  useEffect(() => {
    let active = true;
    void getApprovedMemberImportRecoveryStatusAction(organisationId).then(result => {
      if (!active) return;
      if (result.ok) setRecoverySummary(result.summary);
      else setRecoveryError(result.error);
      setRecoveryLoading(false);
    });
    return () => { active = false; };
  }, [organisationId]);

  const load = (text: string, name: string) => {
    const next = stageMemberCsv(text, mapping);
    const suggested: MemberImportMapping = {};
    for (const [key] of fields) {
      const hit = next.headers.find(header => header.replace(/[^a-z]/gi, "").toLowerCase().includes(key.toLowerCase().replace(/[^a-z]/g, "")));
      if (hit) suggested[key] = hit;
    }
    setSource(text); setFilename(name); setMapping(suggested); setPreview(stageMemberCsv(text, suggested)); setBatch({}); setServerRows([]);
  };
  const applyReport = (value: unknown) => {
    const report = value as { batch?: Record<string, unknown>; rows?: ServerRow[] } | null;
    if (report?.batch) setBatch(report.batch);
    if (Array.isArray(report?.rows)) setServerRows(report.rows);
  };
  const refresh = async (id: string) => { const result = await getMemberImportBatchAction(organisationId, id); if (result.ok) applyReport(result.report); };
  const stage = () => {
    if (!preview) return;
    startTransition(async () => {
      const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source)))).map(value => value.toString(16).padStart(2, "0")).join("");
      const rows = preview.rows.map(row => ({ row_number: row.rowNumber, raw: row.raw }));
      const result = await stageMemberImportAction({ organisationId, filename, checksum, headers: preview.headers, mapping, rows });
      setMessage(result.ok ? "File staged and validated on the server." : result.error ?? "The member file could not be staged.");
      if (result.ok) { const next = result.batch as Record<string, unknown>; setBatch(next); await refresh(String(next.id)); }
    });
  };
  const packageNames = [...new Set(preview?.rows.map(row => row.normalized.membershipName).filter((value): value is string => Boolean(value)) ?? [])];
  const homeLocationsMatched = serverRows.filter(row => row.normalized_values?.homeLocationStatus === "matched").length;
  const homeLocationsMissing = serverRows.filter(row => row.normalized_values?.homeLocationStatus === "not_provided").length;
  const homeLocationsBlocked = serverRows.filter(row => ["unknown", "ambiguous"].includes(row.normalized_values?.homeLocationStatus ?? "")).length;
  const downloadReport = () => {
    const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const lines = [["row", "name", "email", "home_location", "home_location_status", "action", "outcome", "warnings", "blockers"].join(","), ...serverRows.map(row => [row.source_row_number, row.normalized_values?.fullName ?? [row.normalized_values?.firstName, row.normalized_values?.lastName].filter(Boolean).join(" "), row.normalized_values?.email, row.normalized_values?.homeLocation, row.normalized_values?.homeLocationStatus, row.action, row.outcome, (row.warnings ?? []).join("; "), (row.blockers ?? []).join("; ")].map(quote).join(","))];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `member-import-${batchId}.csv`; anchor.click(); URL.revokeObjectURL(url);
  };
  const execute = () => startTransition(async () => {
    const result = await executeMemberImportAction(organisationId, batchId);
    setMessage(result.ok ? "Import completed. No account invitations, activation emails or marketing were sent or queued." : result.error ?? "Import could not be completed.");
    if (result.ok) applyReport(result.batch);
  });
  const recoverBatch = () => {
    if (pending || recoverySummary?.state !== "eligible") return;
    const confirmed = window.confirm(
      "Run the one-time recovery for the verified 702-row Madhouse batch? This preserves its 225 completed rows, attempts only the 477 rejected rows, and will stop if its safety checks do not match. It does not create billing records or subscriptions. Continue?",
    );
    if (!confirmed) return;
    setRecoveryAttempted(true);
    setRecoveryError("");
    startTransition(async () => {
      const result = await recoverApprovedMemberImportBatchAction(organisationId);
      if ("summary" in result && result.summary) setRecoverySummary(result.summary);
      if (!result.ok) {
        setRecoveryError(result.error ?? "Recovery could not be confirmed. Refresh the batch status before taking any further action.");
        return;
      }
      setRecoverySummary(result.summary);
      setRecoveryError("");
    });
  };

  return <section aria-label="Member CSV import"><div className="card">
    <div className="card" aria-labelledby="approved-recovery-title">
      <span className="eyebrow">APPROVED RECOVERY</span>
      <h3 id="approved-recovery-title">Recover the verified Madhouse batch</h3>
      <p className="muted">One-time recovery for batch 6bf9d303-525a-4565-88a4-b4121fac7f98. It calls the dedicated recovery RPC, never the ordinary import execution action.</p>
      {recoveryLoading ? <p className="muted" role="status">Checking recovery status…</p> : null}
      {!recoveryLoading && recoveryError && !recoverySummary ? <p className="error-text" role="alert">{recoveryError}</p> : null}
      {recoverySummary ? <>
        <p className="muted" aria-live="polite">Batch rows: {recoverySummary.total} · Imported: {recoverySummary.imported} · Linked: {recoverySummary.linked} · Skipped: {recoverySummary.skipped ?? "not reported"} · Rejected: {recoverySummary.rejected} · Failed: {recoverySummary.failed ?? "not reported"} · Membership records: {recoverySummary.memberships}</p>
        {recoverySummary.state === "completed" ? <p role="status">Recovery complete: {recoverySummary.recovered} rows recovered; {recoverySummary.skipped ?? "not reported"} previously completed rows skipped; {recoverySummary.rejected} rejected; {recoverySummary.failed ?? "not reported"} failed.</p> : null}
        {recoverySummary.state === "eligible" ? <button type="button" className="primary" disabled={pending || recoveryLoading || recoveryAttempted} onClick={recoverBatch}>{pending ? "Recovering batch…" : recoveryAttempted ? "Recovery attempted · refresh status" : "Run approved one-time recovery"}</button> : null}
        {recoverySummary.state === "not_eligible" ? <p className="muted">The batch does not match the recovery preflight. No recovery action is available.</p> : null}
      </> : null}
      {recoveryError && recoverySummary ? <p className="error-text" role="alert">{recoveryError}</p> : null}
    </div>
    <span className="eyebrow">MEMBER MIGRATION</span><h2>Existing member import</h2>
    <p className="muted">Upload a CSV, map its columns, then review every proposed change. Staging is a dry run and creates no accounts, payments, memberships or access.</p>
    <p className="muted">For Couples or Family contracts, give every covered person the same shared contract ID and identify one responsible payer. This creates one membership and one reviewed billing obligation; importing never charges or resubscribes anyone.</p>
    <p><a href="/templates/member-import.csv" download>Download CSV template</a></p>
    <label>CSV export<input type="file" accept=".csv,text/csv" onChange={event => { const file = event.target.files?.[0]; if (file) void file.text().then(text => load(text, file.name)); }} /></label>
    {preview ? <><h3>1. Map fields</h3><div className="catalogue-import-mapping">{fields.map(([key, label]) => <label key={key}>{label}<select value={mapping[key] ?? ""} onChange={event => { const next = { ...mapping, [key]: event.target.value || undefined }; setMapping(next); setPreview(stageMemberCsv(source, next)); }}><option value="">Not mapped</option>{preview.headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>)}</div>
      <h3>2. Browser preview</h3><p><strong>{preview.rows.length}</strong> source rows · <strong>{preview.rows.filter(row => row.blockers.length).length}</strong> rejected/conflicted · <strong>{preview.rows.reduce((count, row) => count + row.warnings.length, 0)}</strong> warnings</p>
      <div className="club-catalogue-list">{preview.rows.slice(0, 12).map(row => <article className="club-catalogue-row" key={row.rowNumber}><div><strong>Row {row.rowNumber} · {(row.normalized.fullName ?? [row.normalized.firstName, row.normalized.lastName].filter(Boolean).join(" ")) || "Unnamed"}</strong><small>{row.normalized.email ?? "No email"} · {row.normalized.goldenTicketLifetimeCandidate ? "Golden Ticket — Lifetime Membership" : row.normalized.membershipName ?? "No membership"}</small>{row.normalized.goldenTicketLifetimeCandidate && row.normalized.endDate ? <small>Legacy expiry {row.normalized.endDate} will be retained as source evidence, not used as the R12 expiry, only after explicit Golden Ticket product mapping.</small> : null}</div><span className={row.blockers.length ? "error-text" : "muted"}>{row.blockers.length ? row.blockers.join("; ") : row.warnings.join("; ") || "Ready to review"}</span></article>)}</div>
      <button type="button" className="primary" disabled={pending} onClick={stage}>{pending ? "Staging…" : "Run server dry run"}</button></> : null}
    {batchId && packageNames.length ? <div className="card" style={{ marginTop: 12 }}><h3>Map membership packages</h3>{packageNames.map(name => <label key={name}>{name}<select defaultValue="" onChange={event => startTransition(async () => { const result = await mapMemberImportPackageAction({ organisationId, batchId, sourcePackage: name, clubProductId: event.target.value }); setMessage(result.ok ? `${name} mapped.` : result.error ?? "Package mapping could not be saved."); if (result.ok) await refresh(batchId); })}><option value="">Choose an existing R12 package</option>{membershipProducts.map(product => <option key={product.id} value={product.id}>{product.legacyImportCategory ? `${product.name} · historical only, no billing or access` : `${product.name}${product.fixedTermValue && product.fixedTermUnit ? ` · fixed term ${product.fixedTermValue} ${product.fixedTermUnit}${product.fixedTermValue === 1 ? "" : "s"} · no renewal` : ""}${product.archived ? " · archived product, review historical/current mapping" : ""}`}</option>)}</select></label>)}</div> : null}
    {batchId ? <div className="card" style={{ marginTop: 12 }}><strong>Server dry-run result</strong><p className="muted">{String(batch.valid_count ?? 0)} accepted · {String(batch.imported_count ?? 0)} imported · {String(batch.linked_count ?? 0)} linked · {String(batch.skipped_count ?? 0)} skipped · {String(batch.conflicted_count ?? 0)} conflicted · {String(batch.rejected_count ?? batch.blocking_count ?? 0)} rejected</p>
      {serverRows.length ? <p className="muted">Home locations: {homeLocationsMatched} matched · {homeLocationsMissing} not supplied · {homeLocationsBlocked} requiring correction</p> : null}
      {serverRows.length ? <button type="button" className="secondary" onClick={downloadReport}>Download row-by-row report</button> : null}
      <button type="button" className="secondary" disabled={pending || Number(batch.valid_count) < 1} onClick={() => startTransition(async () => { const result = await authoriseMemberImportAction(organisationId, batchId); setMessage(result.ok ? "Valid rows authorised. Conflicted and rejected rows will remain unchanged." : result.error ?? "Import could not be authorised."); if (result.ok) await refresh(batchId); })}>Authorise accepted rows</button>
      <button type="button" className="primary" disabled={pending || String(batch.status) !== "ready"} onClick={execute}>{pending ? "Importing…" : "Execute confirmed import"}</button>
      <p className="muted">Import does not send account invitations, activation emails or marketing.</p>
      {serverRows.filter(row => (row.blockers?.length ?? 0) > 0).slice(0, 20).map(row => <p className="error-text" key={row.source_row_number}>Row {row.source_row_number}: {row.blockers?.join("; ")}</p>)}
    </div> : null}
    {message ? <p role="status">{message}</p> : null}
  </div></section>;
}
