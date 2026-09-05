"use client";
import { useState, useTransition } from "react";
import { recordMembershipCashPaymentAction } from "@/app/club/shop/actions";

type BillingRow = { id: string; amount_minor: number; currency: string; state: string; next_due_at: string; payment_method_family?: string; cash_channel?: string };

export function ClubMembershipCashPayment({ organisationId, locationId, rows }: { organisationId: string; locationId?: string; rows: BillingRow[] }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  const due = rows.find(row => row.payment_method_family === "cash" && ["due", "overdue", "grace", "failed", "retry_scheduled"].includes(row.state));
  if (!due) return <p className="muted">No outstanding cash membership payment.</p>;
  const record = () => {
    if (!locationId) { setMessage("A physical location is required."); return; }
    startTransition(async () => { const result = await recordMembershipCashPaymentAction({ organisationId, obligationId: due.id, locationId, amountMinor: due.amount_minor, currency: due.currency }); setMessage(result.ok ? "Cash membership payment recorded and settled." : result.error); });
  };
  return <div><p className="muted">Due {new Date(due.next_due_at).toLocaleDateString("en-GB")} · £{(due.amount_minor / 100).toFixed(2)} · Cash</p><button type="button" className="primary" onClick={record} disabled={pending || !locationId}>{pending ? "Recording…" : "Record membership payment"}</button>{!locationId ? <p className="muted">Choose a physical location before recording cash.</p> : null}{message ? <p className="muted" role="status">{message}</p> : null}</div>;
}
