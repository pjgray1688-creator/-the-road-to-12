"use client";
import { useState, useTransition } from "react";
import { recordMembershipCashPaymentAction } from "@/app/club/shop/actions";

type BillingRow = {
  id: string;
  amount_minor: number;
  currency: string;
  state: string;
  next_due_at: string;
  payment_method_family?: string;
  frequency?: string;
  billing_anchor_day?: number;
  coverage_start_at?: string | null;
  coverage_end_at?: string | null;
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
function periodFor(row: BillingRow) {
  const due = new Date(row.coverage_start_at ?? row.next_due_at);
  const start = isoDate(due);
  const boundary = row.coverage_end_at ? new Date(row.coverage_end_at) : new Date(due);
  if (!row.coverage_end_at) {
    const frequency = row.frequency ?? "monthly";
    if (frequency === "weekly") boundary.setUTCDate(boundary.getUTCDate() + 7);
    else {
      const months = frequency === "quarterly" ? 3 : frequency === "annual" ? 12 : 1;
      const anchor = row.billing_anchor_day ?? due.getUTCDate();
      boundary.setUTCDate(1);
      boundary.setUTCMonth(boundary.getUTCMonth() + months);
      const last = new Date(Date.UTC(boundary.getUTCFullYear(), boundary.getUTCMonth() + 1, 0)).getUTCDate();
      boundary.setUTCDate(Math.min(anchor, last));
    }
  }
  boundary.setUTCDate(boundary.getUTCDate() - 1);
  return { start, end: isoDate(boundary) };
}

export function ClubMembershipCashPayment({ organisationId, locationId, rows }: { organisationId: string; locationId?: string; rows: BillingRow[] }) {
  const due = rows.find(row => row.payment_method_family === "cash" && ["due", "overdue", "grace", "failed", "retry_scheduled"].includes(row.state));
  const period = due ? periodFor(due) : undefined;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  const [receiptDate, setReceiptDate] = useState(localDate);
  const [billingPeriodStart, setBillingPeriodStart] = useState(period?.start ?? "");
  const [billingPeriodEnd, setBillingPeriodEnd] = useState(period?.end ?? "");
  const [paidThroughDate, setPaidThroughDate] = useState(period?.end ?? "");
  const [verificationNote, setVerificationNote] = useState("");
  const [amountText, setAmountText] = useState<string>();
  if (!due) return <p className="muted">No outstanding cash membership payment.</p>;
  const record = () => {
    if (!locationId) { setMessage("A physical location is required."); return; }
    if (!receiptDate || !billingPeriodStart || !billingPeriodEnd || !paidThroughDate || verificationNote.trim().length < 3) { setMessage("Enter the date received, billing period, paid-through date and how the cash was verified."); return; }
    const amountMinor = amountText === undefined ? due.amount_minor : /^\d+(?:\.\d{1,2})?$/.test(amountText.trim()) ? Math.round(Number(amountText) * 100) : NaN;
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) { setMessage("Enter a valid cash amount to the nearest penny."); return; }
    startTransition(async () => {
      const result = await recordMembershipCashPaymentAction({ organisationId, obligationId: due.id, locationId, amountMinor, currency: due.currency, receiptDate, billingPeriodStart, billingPeriodEnd, paidThroughDate, verificationNote: verificationNote.trim() });
      setMessage(result.ok ? result.coverageNeedsReview ? "Cash receipt recorded for the stated billing period. This membership is expired or inactive; review membership coverage separately before confirming access." : "Verified cash payment recorded for this shared membership period." : result.error);
    });
  };
  return <div>
    <p className="muted">Scheduled {new Date(due.next_due_at).toLocaleDateString("en-GB")} · £{(due.amount_minor / 100).toFixed(2)} · Cash. One payment settles this period for all linked holders; the renewal anniversary remains unchanged.</p>
    <label>Amount received (£)<input type="number" min="0.01" step="0.01" inputMode="decimal" value={amountText ?? (due.amount_minor / 100).toFixed(2)} onChange={event => setAmountText(event.target.value)} /></label>
    <label>Date received<input type="date" value={receiptDate} onChange={event => setReceiptDate(event.target.value)} /></label>
    <label>Billing period starts<input type="date" value={billingPeriodStart} onChange={event => setBillingPeriodStart(event.target.value)} /></label>
    <label>Billing period ends<input type="date" value={billingPeriodEnd} onChange={event => setBillingPeriodEnd(event.target.value)} /></label>
    <label>Paid through<input type="date" value={paidThroughDate} onChange={event => setPaidThroughDate(event.target.value)} /></label>
    <label>Verification note<input value={verificationNote} onChange={event => setVerificationNote(event.target.value)} minLength={3} maxLength={500} placeholder="e.g. Counted at reception; receipt 1842" /></label>
    <button type="button" className="primary" onClick={record} disabled={pending || !locationId || !verificationNote.trim()}>{pending ? "Recording…" : "Record verified cash payment"}</button>
    {!locationId ? <p className="muted">Choose a physical location before recording cash.</p> : null}
    {message ? <p className="muted" role="status">{message}</p> : null}
  </div>;
}
