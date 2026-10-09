"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { staffIssueRefundAction } from "@/app/club/shop/actions";

type Tender = { id: string; method: string; status: string; amountMinor: number; refundedMinor: number; remainingMinor: number };
export type RecentSale = { id: string; createdAt: string; totalMinor: number; currency: string; status: string; locationName: string; customerName: string; items: string[]; hasServiceItems: boolean; serviceEligible?: boolean; serviceReason?: string; serviceRefundableMinor?: number; serviceRemainingUnits?: number; serviceUnit?: string; tenders: Tender[] };

const money = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
const methodName = (value: string) => ({ cash: "Cash", balance: "Madhouse Balance", card: "Card", wallet: "Wallet", direct_debit: "Direct Debit", bank_transfer: "Bank transfer", other: "Other", complimentary: "Complimentary" } as Record<string, string>)[value] ?? value;

export function ClubRecentSales({ organisationId, sales }: { organisationId: string; sales: RecentSale[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, { amount: string; reason: string; reference: string; key: string }>>({});
  const [message, setMessage] = useState("");
  const valueFor = (tender: Tender, sale?: RecentSale) => { const ceiling = sale?.hasServiceItems ? Math.min(tender.remainingMinor, sale.serviceRefundableMinor ?? 0) : tender.remainingMinor; return values[tender.id] ?? { amount: (ceiling / 100).toFixed(2), reason: "", reference: "", key: "" }; };
  const update = (tender: Tender, field: "amount" | "reason" | "reference", value: string) => setValues(current => ({ ...current, [tender.id]: { ...valueFor(tender), [field]: value } }));

  const submit = (sale: RecentSale, tender: Tender) => {
    const value = valueFor(tender, sale);
    if (!value.reason.trim()) { setMessage("Add a reason for the refund."); return; }
    if (!Number.isFinite(Number(value.amount)) || Number(value.amount) <= 0 || Number(value.amount) * 100 > tender.remainingMinor) { setMessage("Enter an amount within the remaining paid amount."); return; }
    if (!['cash', 'balance'].includes(tender.method) && !value.reference.trim()) { setMessage("Complete the refund with the payment provider first, then enter its reference."); return; }
    const key = value.key || crypto.randomUUID();
    setValues(current => ({ ...current, [tender.id]: { ...value, key } }));
    startTransition(async () => {
      const result = await staffIssueRefundAction({ organisationId, paymentId: tender.id, amount: value.amount, reason: value.reason, externalReference: value.reference, idempotencyKey: key });
      setMessage(result.ok ? "Refund recorded. Returned stock, if any, must be checked in separately." : result.error);
      if (result.ok) { setValues(current => { const next = { ...current }; delete next[tender.id]; return next; }); router.refresh(); }
    });
  };

  return <section aria-label="Recent POS sales"><div className="section-heading"><div><span className="eyebrow">RECENT POS SALES</span><h2>Receipts and refunds</h2><p className="muted">Latest completed in-gym sales. Refunds are recorded against their original payment.</p></div></div>
    {sales.length ? <div className="club-list">{sales.map(sale => <article className="club-detail-row" key={sale.id}><div><strong>{sale.customerName} · {money(sale.totalMinor)}</strong><small>{new Date(sale.createdAt).toLocaleString("en-GB")} · {sale.locationName} · {sale.status}</small><small>{sale.items.join(" · ") || "Sale items unavailable"}</small>
      {sale.hasServiceItems ? <><p className="muted">{sale.serviceEligible ? `${sale.serviceRemainingUnits ?? 0} unused ${sale.serviceUnit ?? "service"} units · up to ${money(sale.serviceRefundableMinor ?? 0)} can be refunded. Expired but unused units are included.` : sale.serviceReason ?? "This service purchase cannot currently be reversed safely."}</p>{sale.serviceEligible ? sale.tenders.map(tender => <div className="club-detail-row" key={tender.id}><span><strong>{methodName(tender.method)} · {money(tender.amountMinor)}</strong><small>{tender.status} · {money(tender.remainingMinor)} remaining to refund{tender.refundedMinor ? ` · ${money(tender.refundedMinor)} already refunded` : ""}</small>{tender.remainingMinor > 0 && (sale.serviceRefundableMinor ?? 0) > 0 ? <div className="club-profile-grid"><label>Refund amount<input aria-label={`${methodName(tender.method)} refund amount`} inputMode="decimal" type="number" min="0.01" max={(Math.min(tender.remainingMinor, sale.serviceRefundableMinor ?? 0) / 100).toFixed(2)} step="0.01" value={valueFor(tender, sale).amount} onChange={event => update(tender, "amount", event.target.value)} /></label><label>Reason<input aria-label="Refund reason" maxLength={240} value={valueFor(tender, sale).reason} onChange={event => update(tender, "reason", event.target.value)} /></label>{!['cash', 'balance'].includes(tender.method) ? <label>Provider refund reference<input aria-label="Provider refund reference" maxLength={200} value={valueFor(tender, sale).reference} onChange={event => update(tender, "reference", event.target.value)} /></label> : null}<button type="button" className="secondary" disabled={pending} onClick={() => submit(sale, tender)}>{pending ? "Recording…" : tender.method === "balance" ? "Refund to Balance" : tender.method === "cash" ? "Record cash refund" : "Record provider refund"}</button>{tender.method === "balance" ? <small>Refund is credited to Madhouse Balance and the same unused service units are removed.</small> : tender.method === "cash" ? <small>Return the cash first. Only complete unused service units can be reversed.</small> : <small>Refund externally first; record its reference. Only complete unused service units can be reversed.</small>}</div> : null}</span></div>) : null}</> : sale.tenders.map(tender => <div className="club-detail-row" key={tender.id}><span><strong>{methodName(tender.method)} · {money(tender.amountMinor)}</strong><small>{tender.status} · {money(tender.remainingMinor)} remaining to refund{tender.refundedMinor ? ` · ${money(tender.refundedMinor)} already refunded` : ""}</small>{tender.remainingMinor > 0 ? <div className="club-profile-grid"><label>Refund amount<input aria-label={`${methodName(tender.method)} refund amount`} inputMode="decimal" type="number" min="0.01" max={(tender.remainingMinor / 100).toFixed(2)} step="0.01" value={valueFor(tender).amount} onChange={event => update(tender, "amount", event.target.value)} /></label><label>Reason<input aria-label="Refund reason" maxLength={240} value={valueFor(tender).reason} onChange={event => update(tender, "reason", event.target.value)} /></label>{!['cash', 'balance'].includes(tender.method) ? <label>Provider refund reference<input aria-label="Provider refund reference" maxLength={200} value={valueFor(tender).reference} onChange={event => update(tender, "reference", event.target.value)} /></label> : null}<button type="button" className="secondary" disabled={pending} onClick={() => submit(sale, tender)}>{pending ? "Recording…" : tender.method === "balance" ? "Refund to Balance" : tender.method === "cash" ? "Record cash refund" : "Record provider refund"}</button>{tender.method === "balance" ? <small>The amount is credited to the customer’s Madhouse Balance.</small> : tender.method === "cash" ? <small>Return the cash before recording this action.</small> : <small>Refund externally first; this records the completed provider refund only.</small>}</div> : null}</span></div>)}</div></article>)}</div> : <p className="muted">No completed POS sales to show yet.</p>}
    {message ? <p role="status" className="muted">{message}</p> : null}
  </section>;
}
