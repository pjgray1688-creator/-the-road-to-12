"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { saveLegacyMembershipReviewAction } from "@/app/club/members/actions";
import type { ClubProduct } from "@/lib/club";
import type { OrganisationLocation } from "@/lib/club";
import styles from "./club-legacy-membership-review.module.css";

type Candidate = {
  import_row_id: string; batch_id: string; customer_id: string; display_name: string;
  source_member_reference?: string; original_offer_name?: string; original_start_date?: string;
  original_end_date?: string; original_home_venue?: string; original_billing_label?: string;
  original_responsible_payer_reference?: string;
  original_household_reference?: string; original_promotional_rate?: string;
  original_recurring_amount?: string; original_joining_fee_waived?: string; original_promotion_label?: string;
  original_billing_interval?: string; original_package_wording?: string; mapping_product_id?: string;
  existing_membership_id?: string; existing_membership_product_id?: string;
  existing_membership_name?: string; existing_membership_status?: string;
  review?: Record<string, unknown> | null;
};
const moneyValue = (value?: string) => {
  if (!value) return "";
  const normalized = value.replace(/[£,\s]/g, "");
  return /^\d+(?:\.\d{1,2})?$/.test(normalized) ? normalized : "";
};

export function ClubLegacyMembershipReview({ organisationId, candidates, products, locations }: { organisationId: string; candidates: Candidate[]; products: ClubProduct[]; locations: OrganisationLocation[] }) {
  const router = useRouter();
  const [query, setQuery] = useState(""); const [page, setPage] = useState(0); const [message, setMessage] = useState(""); const [pending, startTransition] = useTransition();
  const matching = useMemo(() => candidates.filter(row => `${row.display_name} ${row.source_member_reference ?? ""} ${row.original_offer_name ?? ""} ${row.original_home_venue ?? ""}`.toLocaleLowerCase("en-GB").includes(query.trim().toLocaleLowerCase("en-GB"))), [candidates, query]);
  const pageRows = matching.slice(page * 20, page * 20 + 20);
  const save = (event: FormEvent<HTMLFormElement>, candidate: Candidate) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const poundsToMinor = (key: string) => { const value = String(data.get(key) ?? "").trim(); if (!value) return null; const numeric = Number(value); return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric * 100) : -1; };
    const decision = {
      customerId: candidate.customer_id,
      canonicalProductId: String(data.get("product") ?? "") || null,
      homeLocationId: String(data.get("location") ?? "") || null,
      personIdentityState: String(data.get("identity")),
      billingEvidenceState: String(data.get("billingEvidence")),
      joiningFeeWaived: String(data.get("feeWaived") ?? "") || null,
      promotionalRateMinor: poundsToMinor("promotionRate"),
      promotionLabel: String(data.get("promotionLabel") ?? ""),
      billingInterval: String(data.get("interval") ?? ""),
      historicPackageWording: String(data.get("wording") ?? ""),
      verifiedRecurringAmountMinor: poundsToMinor("verifiedRate"),
      sourceMembershipReference: String(data.get("reference") ?? ""),
      householdReference: String(data.get("household") ?? ""),
      responsiblePayerReference: String(data.get("payerReference") ?? "") || null,
      evidenceNote: String(data.get("evidence") ?? ""),
    };
    if (decision.promotionalRateMinor === -1 || decision.verifiedRecurringAmountMinor === -1) { setMessage("Enter valid non-negative GBP amounts."); return; }
    startTransition(async () => { const result = await saveLegacyMembershipReviewAction({ organisationId, importRowId: candidate.import_row_id, decision }); setMessage(result.ok ? "Review saved. No membership, billing or access was changed." : result.error ?? "Review could not be saved."); if (result.ok) router.refresh(); });
  };
  return <section className={`card ${styles.section}`} aria-label="Legacy membership mapping and review">
    <span className="eyebrow">HISTORICAL MEMBERSHIP REVIEW</span><h2>Map legacy memberships</h2>
    <p className="muted">Match each imported ClubManager source row to an existing management product and record verified identity, venue and billing evidence. This is review-only: it does not create memberships, charges, mandates, invitations or access.</p>
    <label className={styles.search}>Search name, ClubManager reference, offer or venue<input value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></label>
    <p className="muted">{matching.length.toLocaleString("en-GB")} imported source rows · {candidates.filter(row => row.review?.review_state === "reviewed").length.toLocaleString("en-GB")} reviewed</p>
    {pageRows.map(candidate => <details key={candidate.import_row_id} className={styles.row}><summary><strong>{candidate.display_name}</strong><span>{candidate.original_offer_name ?? "Offer not recorded"} · Ref {candidate.source_member_reference ?? "not recorded"}</span></summary>
      <div className={styles.source}>Existing imported membership: {candidate.existing_membership_name ?? "None linked"}{candidate.existing_membership_status ? ` · ${candidate.existing_membership_status}` : ""}{candidate.existing_membership_id ? ` · ${candidate.existing_membership_id}` : ""}<br />Original dates: {candidate.original_start_date ?? "not recorded"} – {candidate.original_end_date ?? "open / not recorded"} · Home venue: {candidate.original_home_venue ?? "not recorded"} · Billing evidence: {candidate.original_billing_label ?? "not recorded"} {candidate.original_recurring_amount ? `· £${candidate.original_recurring_amount}` : ""}</div>
      <form className={styles.form} onSubmit={event => save(event, candidate)}>
        <label>Canonical management product<select name="product" defaultValue={String(candidate.review?.canonical_product_id ?? candidate.mapping_product_id ?? "")}><option value="">Needs mapping</option>{products.filter(product => product.kind === "membership").map(product => <option key={product.id} value={product.id}>{product.name}{product.archivedAt ? " · Archived historical" : product.sellable ? " · Public sale" : " · Management only"}</option>)}</select></label>
        <label>Home venue<select name="location" defaultValue={String(candidate.review?.home_location_id ?? "")}><option value="">Not verified</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label>Person identity<select name="identity" defaultValue={String(candidate.review?.person_identity_state ?? "needs_review")}><option value="needs_review">Needs review</option><option value="verified">Verified against source reference/records</option><option value="mismatch">Mismatch</option></select></label>
        <label>Billing evidence<select name="billingEvidence" defaultValue={String(candidate.review?.billing_evidence_state ?? "not_reviewed")}><option value="not_reviewed">Not reviewed</option><option value="verified">Verified</option><option value="no_evidence">No evidence available</option><option value="mismatch">Mismatch</option></select></label>
        <label>Source membership reference<input name="reference" defaultValue={String(candidate.review?.source_membership_reference ?? candidate.source_member_reference ?? "")} /></label>
        <label>Verified recurring price (£)<input name="verifiedRate" type="number" min="0" step="0.01" defaultValue={candidate.review?.verified_recurring_amount_minor == null ? "" : (Number(candidate.review.verified_recurring_amount_minor) / 100).toFixed(2)} /></label>
        <label>Promotional rate (£)<input name="promotionRate" type="number" min="0" step="0.01" defaultValue={candidate.review?.promotional_rate_minor == null ? moneyValue(candidate.original_promotional_rate) : (Number(candidate.review.promotional_rate_minor) / 100).toFixed(2)} /></label>
        <label>Joining fee waived<select name="feeWaived" defaultValue={candidate.review?.joining_fee_waived == null ? (/^(yes|true|waived)$/i.test(candidate.original_joining_fee_waived ?? "") ? "true" : /^(no|false|charged)$/i.test(candidate.original_joining_fee_waived ?? "") ? "false" : "") : String(candidate.review.joining_fee_waived)}><option value="">Not verified</option><option value="true">Yes</option><option value="false">No</option></select></label>
        <label>Billing interval<select name="interval" defaultValue={String(candidate.review?.billing_interval ?? candidate.original_billing_interval ?? "")}><option value="">Not verified</option>{["weekly","fortnightly","four_weekly","monthly","quarterly","annual","one_off","lifetime","other"].map(value => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
        <label>Promotion wording<input name="promotionLabel" defaultValue={String(candidate.review?.promotion_label ?? candidate.original_promotion_label ?? "")} /></label>
        <label>Historic package wording<input name="wording" defaultValue={String(candidate.review?.historic_package_wording ?? candidate.original_package_wording ?? candidate.original_offer_name ?? "")} /></label>
        <label>Household / shared contract reference<input name="household" defaultValue={String(candidate.review?.household_reference ?? candidate.original_household_reference ?? "")} /></label>
        <label>Responsible payer ClubManager reference<input name="payerReference" defaultValue={String(candidate.review?.responsible_payer_reference ?? candidate.original_responsible_payer_reference ?? "")} /></label>
        <label className={styles.evidence}>Evidence and review note<textarea name="evidence" minLength={8} maxLength={1000} defaultValue={String(candidate.review?.evidence_note ?? "")} placeholder="Record source reference, verified identity evidence and/or billing evidence used." /></label>
        <button className="primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Save review only"}</button>
      </form>
    </details>)}
    {matching.length > 20 ? <div className={styles.pagination}><button type="button" className="secondary" disabled={page===0} onClick={() => setPage(value => Math.max(0,value-1))}>Previous</button><span>Page {page+1} of {Math.ceil(matching.length/20)}</span><button type="button" className="secondary" disabled={(page+1)*20>=matching.length} onClick={() => setPage(value => value+1)}>Next</button></div> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
