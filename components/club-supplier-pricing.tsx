"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { supplierPricing, type SupplierPricingOffer } from "@/lib/club-supplier-catalogue";
import { parseMinorUnits } from "@/lib/club-money";
import { pricingMath } from "@/lib/club-pricing";
import { deriveGoldenTicketCandidates } from "@/lib/club-promotions";
import { setSupplierVariantRetailPriceAction } from "@/app/club/shop/supplier-catalogue/actions";
import { syncActiveSportsCatalogueAction } from "@/app/club/products/actions";
import styles from "./club-products-pricing.module.css";

const money = (minor: number) => `£${(minor / 100).toFixed(2)}`;
const date = (value: string | null) => value ? new Date(value).toLocaleString("en-GB", { timeZone: "Europe/London" }) : "Not supplied";
const formatWorkerError = (value: unknown) => {
  if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  if (value && typeof value === "object") {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }
  return value === null ? "null" : value === undefined ? "undefined" : String(value);
};
function health(offer: SupplierPricingOffer) {
  if (offer.trade_cost_minor === null || offer.vat_rate === null) return "Missing required data";
  if (offer.retail_price_minor === null || offer.retail_price_minor <= 0) return "Price review";
  if (supplierPricing(offer.trade_cost_minor, offer.vat_rate, offer.retail_price_minor).belowFloor) return "Below margin floor";
  if (offer.availability_status !== "available") return "Supplier unavailable";
  return "Healthy";
}

function Offer({ offer, organisationId }: { offer: SupplierPricingOffer; organisationId: string }) {
  const router = useRouter();
  const [price, setPrice] = useState(((offer.retail_price_minor ?? 0) / 100).toFixed(2));
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  const [fee, setFee] = useState("");
  const [pending, start] = useTransition();
  const minor = parseMinorUnits(price);
  const valid = minor !== undefined && minor > 0 && minor <= 100000000;
  const current = offer.trade_cost_minor !== null && offer.vat_rate !== null ? supplierPricing(offer.trade_cost_minor, offer.vat_rate, offer.retail_price_minor ?? undefined) : undefined;
  const preview = current && valid ? supplierPricing(offer.trade_cost_minor!, offer.vat_rate!, minor) : undefined;
  const goldenSaving = valid ? deriveGoldenTicketCandidates([{ id: offer.id, label: offer.name, lines: [{ id: offer.id, productId: offer.id, unitPriceMinor: minor, quantity: 1 }] }])[0].eligibleMinor : 0;
  const goldenPrice = valid ? minor - goldenSaving : 0;
  const stress = preview && fee.trim() && /^\d+(\.\d+)?$/.test(fee) ? pricingMath(preview.trueCostMinor, goldenPrice, 0, Number(fee)) : undefined;
  return <details className={styles.offer}>
    <summary><span><strong>{offer.brand} · {offer.name}</strong><small>{[offer.size, offer.variant, offer.member_orderable_unit && `${offer.member_orderable_unit}${offer.pack_quantity ? ` of ${offer.pack_quantity}` : ""}`].filter(Boolean).join(" · ")}</small></span><span>{offer.retail_price_minor === null ? "Unpriced" : money(offer.retail_price_minor)}<small>{health(offer)}{offer.manual_price ? " · Manual price" : ""}{offer.cost_history.length > 1 ? " · Cost changed" : ""}</small></span></summary>
    <dl className={styles.facts}>
      <div><dt>Supplier</dt><dd>{offer.supplier}</dd></div><div><dt>Supplier availability</dt><dd>{offer.availability_status === "available" ? "In stock at supplier" : "Unavailable at supplier"}</dd></div>
      <div><dt>Local Madhouse stock · all venues</dt><dd>{offer.local_stock}</dd></div><div><dt>Last stock check</dt><dd>{date(offer.availability_checked_at)}</dd></div>
      <div><dt>Supplier SKU / barcode</dt><dd>{offer.supplier_sku ?? "No SKU"} / {offer.barcode ?? "No barcode"}</dd></div>
      <div><dt>Supplier trade cost ex VAT</dt><dd>{offer.trade_cost_minor === null ? "Not supplied" : money(offer.trade_cost_minor)}</dd></div><div><dt>Supplier VAT</dt><dd>{offer.vat_rate === null ? "Not supplied" : `${Number((offer.vat_rate * 100).toFixed(4))}%`}</dd></div>
      <div><dt>True Madhouse cost inc VAT</dt><dd>{current ? money(current.trueCostMinor) : "Not available"}</dd></div><div><dt>30% gross-margin floor</dt><dd>{current ? money(current.recommendedFloorMinor) : "Not available"}</dd></div>
      <div><dt>Current gross margin</dt><dd>{current?.marginPercent?.toFixed(1) ?? "—"}%</dd></div><div><dt>Cost source</dt><dd>{offer.cost_source ?? "Not supplied"}</dd></div>
    </dl>
    <form onSubmit={event => { event.preventDefault(); if (!valid) return; if (!confirm) { setConfirm(true); return; } start(async () => { try { const result = await setSupplierVariantRetailPriceAction({ organisationId, variantId: offer.id, retailPriceMinor: minor }); setMessage(result.ok ? "Selling price saved. Future supplier refreshes will retain it." : result.error ?? "Selling price could not be saved."); if (result.ok) { setConfirm(false); router.refresh(); } } catch { setMessage("Price could not be saved. Please retry."); } }); }}>
      <div className={styles.controls}><label>Madhouse selling price · GBP<input inputMode="decimal" required value={price} onChange={event => { setPrice(event.target.value); setConfirm(false); setMessage(""); }} /></label></div>
      {preview ? <p>New gross margin: <strong>{preview.marginPercent?.toFixed(1)}%</strong> · Gross profit: {money(minor! - preview.trueCostMinor)}{preview.belowFloor ? <span className={styles.warning}> · Below the recommended {money(preview.recommendedFloorMinor)} floor. Confirm only if this is intentional.</span> : " · Meets normal floor"}</p> : <p className={styles.warning}>{valid ? "Cost evidence is missing; margin cannot be checked." : "Enter a positive GBP price with up to two decimal places."}</p>}
      {confirm ? <p>Confirm selling this {offer.member_orderable_unit ?? "variant"} at <strong>{money(minor!)}</strong>? Supplier cost will stay {offer.trade_cost_minor === null ? "unchanged" : `${money(offer.trade_cost_minor)} ex VAT`}.</p> : null}
      <button className="primary" disabled={pending || !valid}>{pending ? "Saving…" : confirm ? "Confirm selling price" : "Review selling price"}</button>{confirm ? <button type="button" className="secondary" onClick={() => setConfirm(false)} disabled={pending}>Cancel</button> : null}
      {message ? <p role="status">{message}</p> : null}
    </form>
    {preview ? <details><summary>Promotion &amp; payment headroom</summary><p>Golden Ticket 20% scenario: {money(goldenPrice)} after discount, {money(goldenPrice - preview.trueCostMinor)} gross profit, {goldenPrice ? ((goldenPrice - preview.trueCostMinor) / goldenPrice * 100).toFixed(1) : "—"}% margin. {goldenPrice < preview.recommendedFloorMinor ? "Price review: this discount falls below the normal floor." : "Meets the normal floor."}</p><p className="muted">Planning scenario using the existing Golden Ticket calculation. Eligibility and promotion stacking are evaluated at checkout.</p><div className={styles.controls}><label>Merchant fee allowance %<input inputMode="decimal" value={fee} placeholder="Enter your contracted rate" onChange={event => setFee(event.target.value)} /></label></div><p>{stress ? `After discount and fee allowance: ${money(stress.profitAfterFeeMinor)} profit. Fixed provider fees are not included.` : "Enter a valid fee allowance to estimate payment headroom. This is not a provider quote."}</p></details> : null}
    <details><summary>Supplier cost history</summary><p className="muted">Current cost comes from the reviewed supplier import. Correct source cost/VAT in a full catalogue refresh with a new source note; selling-price edits never change it.</p>{offer.cost_history.length ? <ol className={styles.history}>{offer.cost_history.map((entry, index) => <li key={`${entry.created_at}-${index}`}>{date(entry.created_at)} · True cost {money(entry.cost_minor)}{entry.supplied_vat_rate !== null ? ` · VAT ${entry.supplied_vat_rate * 100}%` : ""} · {entry.source_reference ?? "Cost evidence"}</li>)}</ol> : <p>No cost history recorded.</p>}</details>
  </details>;
}

export function ClubSupplierPricing({ organisationId, offers }: { organisationId: string; offers: SupplierPricingOffer[] }) {
  const [query, setQuery] = useState(""); const [category, setCategory] = useState(""); const [availability, setAvailability] = useState(""); const [review, setReview] = useState(""); const [limit, setLimit] = useState(50);
  const rows = useMemo(() => offers.filter(offer => [offer.name, offer.brand, offer.supplier, offer.variant, offer.size, offer.supplier_sku, offer.barcode, offer.category].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())) && (!category || offer.category === category) && (!availability || offer.availability_status === availability) && (!review || (review === "Manual price" ? offer.manual_price : review === "Cost changed" ? offer.cost_history.length > 1 : health(offer) === review))), [offers, query, category, availability, review]);
  return <section className={styles.supplierPanel} aria-label="Supplier products and pricing"><h2>Supplier products &amp; pricing</h2><div className={styles.controls}><label>Find a supplier variant<input placeholder="Product, brand, supplier, SKU or barcode" value={query} onChange={event => { setQuery(event.target.value); setLimit(50); }} /></label><label>Category<select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{[...new Set(offers.map(offer => offer.category).filter((value): value is string => Boolean(value)))].sort().map(value => <option key={value}>{value}</option>)}</select></label><label>Supplier availability<select value={availability} onChange={event => setAvailability(event.target.value)}><option value="">All availability</option><option value="available">In stock</option><option value="unavailable">Unavailable</option><option value="unknown">Not checked</option></select></label><label>Pricing review<select value={review} onChange={event => setReview(event.target.value)}><option value="">All states</option>{["Healthy", "Price review", "Below margin floor", "Missing required data", "Supplier unavailable", "Manual price", "Cost changed"].map(value => <option key={value}>{value}</option>)}</select></label></div><p>{rows.length} variants found</p>{rows.slice(0, limit).map(offer => <Offer key={`${offer.id}-${offer.retail_price_minor}`} offer={offer} organisationId={organisationId} />)}{rows.length > limit ? <button className="secondary" onClick={() => setLimit(limit + 50)}>Show 50 more</button> : null}<ActiveSportsImport organisationId={organisationId} /></section>;
}

export function ActiveSportsImport({ organisationId }: { organisationId: string }) {
  const [csv, setCsv] = useState(""); const [fileName, setFileName] = useState(""); const [message, setMessage] = useState(""); const [diagnostic, setDiagnostic] = useState<Record<string, unknown>>(); const [result, setResult] = useState<{ updated: number; created: number; discontinued: number; skipped: number; durationMs: number }>(); const [pending, start] = useTransition();
  const run = () => start(async () => { try { const next = await syncActiveSportsCatalogueAction({ organisationId, csv, fileName }); if (!next.ok) { setMessage(next.error); setDiagnostic(next.diagnostic as Record<string, unknown>); setResult(undefined); return; } setResult(next); setDiagnostic(undefined); setMessage("Active Sports catalogue updated."); } catch (error) { const value = error as { name?: unknown; message?: unknown; stack?: unknown }; setMessage("Import failed"); setDiagnostic({ operation: "Active Sports synchronisation", name: typeof value.name === "string" ? value.name : "Error", message: typeof value.message === "string" ? value.message : String(error), ...(process.env.NODE_ENV === "development" && typeof value.stack === "string" ? { stack: value.stack } : {}) }); } });
  return <details className={styles.offer}><summary><strong>Active Sports Weekly Catalogue Update</strong></summary><p>Upload the latest Active Sports CSV. Supplier cost, availability, images and descriptions are synchronised without changing club stock or retail pricing.</p><label>Upload the latest Active Sports CSV<input type="file" accept=".csv,text/csv" disabled={pending} onChange={event => { const file = event.target.files?.[0]; if (!file) return; setFileName(file.name); void file.text().then(text => { setCsv(text); setResult(undefined); setDiagnostic(undefined); setMessage(""); }).catch(error => { setMessage("Import failed"); setDiagnostic({ operation: "CSV file read", message: error instanceof Error ? error.message : String(error) }); }); }} /></label><button type="button" className="primary" disabled={pending || !csv} onClick={run}>{pending ? "Importing…" : "Import Active Sports Catalogue"}</button>{diagnostic ? <section className={styles.warning} aria-label="Import diagnostics"><h4>Import failed</h4>{Object.entries(diagnostic).map(([key, value]) => <div key={key}><strong>{key}</strong><pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre></div>)}</section> : null}{result ? <dl className={styles.facts}><div><dt>Products updated</dt><dd>{result.updated}</dd></div><div><dt>New products created</dt><dd>{result.created}</dd></div><div><dt>Products discontinued</dt><dd>{result.discontinued}</dd></div><div><dt>Products skipped</dt><dd>{result.skipped}</dd></div><div><dt>Duration</dt><dd>{result.durationMs}ms</dd></div></dl> : null}{message ? <p role="status">{message}</p> : null}</details>;
}
