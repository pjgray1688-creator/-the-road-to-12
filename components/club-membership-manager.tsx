"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ClubProduct, OrganisationLocation } from "@/lib/club";
import { recordExistingMembershipCashPaymentAction, updateClubMembershipAction } from "@/app/club/members/actions";
import styles from "./club-member-management.module.css";

type Payment = { id: string; kind: string; method?: string; state?: string; amount_minor: number; currency: string; payment_received_at?: string; external_reference?: string; paid_through_date?: string; evidence_note?: string };
export type MembershipManagementDetail = {
  id: string; product_id: string; product_name: string; product_kind: string; billing: string; is_lifetime: boolean;
  status: "active" | "paused" | "expired" | "cancelled"; starts_at: string; ends_at?: string | null; source: string;
  billing_arrangement?: { provider_type?: string; payment_method_family?: string; state?: string; provider_subscription_reference?: string; next_due_at?: string; frequency?: string } | null;
  payments: Payment[]; shared_contract: boolean; has_billing_obligation: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);
const inclusiveEnd = (value?: string | null) => value ? new Date(new Date(value).getTime() - 86400000).toISOString().slice(0, 10) : "";
const money = (amount: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency: currency || "GBP" }).format(amount / 100);

export function ClubMembershipManager({ organisationId, customerId, detail, products, locations, canManage, canRecordCash }: { organisationId: string; customerId: string; detail: MembershipManagementDetail; products: ClubProduct[]; locations: OrganisationLocation[]; canManage: boolean; canRecordCash: boolean }) {
  const [editing, setEditing] = useState(false); const [cashOpen, setCashOpen] = useState(false); const [paidThroughPreview, setPaidThroughPreview] = useState("");
  const [pending, startTransition] = useTransition(); const [message, setMessage] = useState(""); const router = useRouter();
  const [paymentKey, setPaymentKey] = useState(() => crypto.randomUUID());
  const providerManaged = Boolean(detail.billing_arrangement);
  const productOptions = products.filter(product => product.kind === "membership"
    && (product.id === detail.product_id || (!product.archivedAt && !product.legacyImportCategory)));
  function update(form: FormData) {
    if (!window.confirm("Save this membership change? Provider billing, payments and household payer details will not be changed.")) return;
    startTransition(async () => {
      setMessage("");
      const result = await updateClubMembershipAction({ organisationId, customerId, membershipId: detail.id,
        productId: String(form.get("productId") ?? detail.product_id), status: String(form.get("status") ?? "expired") as "active" | "paused" | "expired",
        startsOn: String(form.get("startsOn") ?? ""), endsOn: String(form.get("endsOn") ?? ""), reason: String(form.get("reason") ?? "") });
      if (!result.ok) { setMessage(result.error); return; }
      setMessage("Membership details saved and audited."); setEditing(false); router.refresh();
    });
  }
  function recordCash(form: FormData) {
    const amount = String(form.get("amount") ?? "").trim();
    const amountMinor = /^\d+(?:\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : NaN;
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) { setMessage("Enter a valid amount in pounds."); return; }
    if (!window.confirm(`Record ${money(amountMinor, "GBP")} cash received and extend access through ${String(form.get("paidThrough") ?? "the selected date")}?`)) return;
    startTransition(async () => {
      setMessage("");
      const result = await recordExistingMembershipCashPaymentAction({ organisationId, customerId, membershipId: detail.id,
        locationId: String(form.get("locationId") ?? ""), amountMinor,
        receiptDate: String(form.get("receiptDate") ?? ""), periodStart: String(form.get("periodStart") ?? ""),
        periodEnd: String(form.get("periodEnd") ?? ""), paidThrough: String(form.get("paidThrough") ?? ""),
        note: String(form.get("note") ?? ""), idempotencyKey: paymentKey });
      if (!result.ok) { setMessage(result.error); return; }
      setMessage(`Cash recorded. Membership is paid through ${new Date(`${result.paidThrough}T12:00:00`).toLocaleDateString("en-GB")}.`);
      setPaymentKey(crypto.randomUUID()); setCashOpen(false); router.refresh();
    });
  }
  const providerLabel = detail.billing_arrangement ? `${detail.billing_arrangement.provider_type ?? "Manual"} · ${detail.billing_arrangement.payment_method_family ?? "payment method not recorded"} · ${detail.billing_arrangement.state ?? "status unavailable"}` : "No provider-managed billing arrangement";
  return <section className={styles.manager}>
    <div className="club-detail-row"><span><strong>Manage membership</strong><small>{detail.product_name} · {detail.status.replaceAll("_", " ")} · {detail.source.replaceAll("_", " ")}</small><small>{new Date(detail.starts_at).toLocaleDateString("en-GB")} – {detail.is_lifetime ? "Lifetime" : detail.ends_at ? new Date(inclusiveEnd(detail.ends_at) + "T12:00:00").toLocaleDateString("en-GB") : "End date not recorded"}</small><small>{providerLabel}{detail.billing_arrangement?.provider_subscription_reference ? ` · Ref ${detail.billing_arrangement.provider_subscription_reference}` : ""}</small></span>
      {canManage && !providerManaged && detail.status !== "cancelled" && !detail.shared_contract ? <button className="secondary" type="button" onClick={() => { setEditing(value => !value); setMessage(""); }}>{editing ? "Close editor" : "Manage membership"}</button> : providerManaged ? <span className="muted">Provider managed</span> : detail.shared_contract ? <span className="muted">Household managed</span> : null}</div>
    {editing ? <form action={update} className={styles.manager}>
      <label>Membership product<select name="productId" defaultValue={detail.product_id}>{productOptions.map(product => <option key={product.id} value={product.id}>{product.name}{product.isLifetime ? " · Lifetime" : product.fixedTermValue ? ` · ${product.fixedTermValue} ${product.fixedTermUnit} fixed term` : ` · ${product.billing}`}{product.archivedAt || product.legacyImportCategory ? " · existing record" : ""}</option>)}</select></label>
      <label>Status<select name="status" defaultValue={detail.status === "cancelled" ? "expired" : detail.status} disabled={detail.status === "cancelled"}><option value="active">Active</option><option value="paused">Paused</option><option value="expired">Lapsed</option></select></label>
      <label>Start date<input name="startsOn" type="date" required defaultValue={detail.starts_at.slice(0, 10)} /></label>
      <label>Paid through / expiry date<input name="endsOn" type="date" defaultValue={detail.is_lifetime ? "" : inclusiveEnd(detail.ends_at)} disabled={detail.is_lifetime} /></label>
      {detail.is_lifetime ? <p className="muted">This verified lifetime product has no expiry date.</p> : null}
      {detail.shared_contract ? <p className="muted">Shared payer terms are shown separately; changes to this membership are blocked until managed through its household contract.</p> : null}
      <label>Reason for change<textarea name="reason" required minLength={8} maxLength={500} /></label>
      <div className={styles.actions}><button className="primary" disabled={pending || detail.shared_contract} type="submit">{pending ? "Saving…" : "Save membership"}</button><button className="secondary" type="button" disabled={pending} onClick={() => setEditing(false)}>Cancel</button></div>
    </form> : null}
    {canRecordCash && !providerManaged && !detail.shared_contract && !detail.has_billing_obligation ? <div className="club-cash-member-payment">
      {!cashOpen ? <button className="secondary" type="button" onClick={() => { setCashOpen(true); setPaidThroughPreview(""); setMessage(""); }}>Record cash payment</button> : <form action={recordCash} className={styles.cashForm}>
        <p className="muted">Record money physically received. This records the payment and paid-through date; it does not create a subscription or provider payment.</p>
        <label>Venue<select name="locationId" required defaultValue=""><option value="" disabled>Choose venue</option>{locations.filter(location => location.active).map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label>Amount received (£)<input name="amount" inputMode="decimal" type="number" min="0.01" step="0.01" required /></label>
        <label>Date paid<input name="receiptDate" type="date" max={today()} defaultValue={today()} required /></label>
        <label>Membership period starts<input name="periodStart" type="date" required /></label>
        <label>Membership period ends<input name="periodEnd" type="date" required onChange={event => setPaidThroughPreview(event.currentTarget.value)} /></label>
        <label>Paid through<input name="paidThrough" type="date" value={paidThroughPreview} readOnly required /></label>
        <p className="muted">Preview: access runs through {paidThroughPreview ? new Date(`${paidThroughPreview}T12:00:00`).toLocaleDateString("en-GB") : "the selected period end"}; the stored expiry boundary is the following midnight in Europe/London.</p>
        <label>Receipt / note<textarea name="note" minLength={8} maxLength={500} required placeholder="For example: cash counted at reception; receipt reference" /></label>
        <div className={styles.actions}><button className="primary" type="submit" disabled={pending}>{pending ? "Recording…" : "Confirm cash received"}</button><button className="secondary" type="button" disabled={pending} onClick={() => setCashOpen(false)}>Cancel</button></div>
      </form>}
    </div> : null}
    {detail.has_billing_obligation ? <p className="muted">This membership already has a billing schedule. Record cash against its outstanding obligation so the schedule reconciles correctly.</p> : null}
    {detail.shared_contract ? <p className="muted">Payments for this membership are managed through its verified shared payer contract.</p> : null}
    {providerManaged ? <p className="muted">Paid-through status follows the verified provider records. Manual date and cash changes are disabled.</p> : null}
    {detail.payments.length ? <div><h3>Payment history</h3>{detail.payments.map(payment => <div className="club-detail-row" key={`${payment.kind}:${payment.id}`}><span>{payment.method ?? payment.kind} · {payment.state ?? "recorded"}<small>{payment.payment_received_at ? new Date(payment.payment_received_at).toLocaleString("en-GB") : "Date not recorded"}{payment.paid_through_date ? ` · Paid through ${new Date(`${payment.paid_through_date}T12:00:00`).toLocaleDateString("en-GB")}` : ""}{payment.external_reference ? ` · Ref ${payment.external_reference}` : ""}{payment.evidence_note ? ` · ${payment.evidence_note}` : ""}</small></span><strong>{money(payment.amount_minor, payment.currency)}</strong></div>)}</div> : <p className="muted">No membership payment history is recorded here.</p>}
    {message ? <p role="status" className="muted">{message}</p> : null}
  </section>;
}
