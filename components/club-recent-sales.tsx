"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { staffIssueRefundAction } from "@/app/club/shop/actions";
import { refundLineAmount, refundSelectionTotal, type RefundableLine } from "@/lib/club-refund-allocation";

type Tender = { id: string; method: string; status: string; amountMinor: number; refundedMinor: number; remainingMinor: number };
type RefundRecord = { id: string; amountMinor: number; createdAt: string; reason: string; externalReference?: string; staffName: string; method: string; lines: Array<{ name: string; quantity: number; unit: string; amountMinor: number }> };
export type RecentSale = { id: string; createdAt: string; totalMinor: number; currency: string; status: string; locationName: string; customerName: string; items: string[]; refundLines: RefundableLine[]; tenders: Tender[]; refunds: RefundRecord[] };

const money = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);
const methodName = (value: string) => ({ cash: "Cash", balance: "Madhouse Balance", card: "Card", wallet: "Wallet", direct_debit: "Direct Debit", bank_transfer: "Bank transfer", other: "Other", complimentary: "Complimentary" } as Record<string, string>)[value] ?? value;

export function ClubRecentSales({ organisationId, sales }: { organisationId: string; sales: RecentSale[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selection, setSelection] = useState<Record<string, Record<string, number>>>({});
  const [details, setDetails] = useState<Record<string, { reason: string; reference: string; key: string }>>({});
  const [message, setMessage] = useState("");
  const detailFor = (tenderId: string) => details[tenderId] ?? { reason: "", reference: "", key: "" };
  const allocation = (sale: RecentSale) => sale.refundLines.flatMap(line => {
    const quantity = selection[sale.id]?.[line.orderItemId] ?? 0;
    return quantity > 0 ? [{ orderItemId: line.orderItemId, quantity }] : [];
  });

  const submit = (sale: RecentSale, tender: Tender) => {
    const value = detailFor(tender.id);
    const lines = allocation(sale);
    const amount = refundSelectionTotal(sale.refundLines, selection[sale.id] ?? {});
    if (!lines.length || amount <= 0) { setMessage("Choose at least one refundable item or service unit."); return; }
    if (amount > tender.remainingMinor) { setMessage("The selected items exceed the amount remaining on this payment."); return; }
    if (!value.reason.trim()) { setMessage("Add a reason for the refund."); return; }
    if (tender.method !== "cash" && tender.method !== "balance" && !value.reference.trim()) { setMessage("Complete the refund with the payment provider first, then enter its reference."); return; }
    const key = value.key || crypto.randomUUID();
    setDetails(current => ({ ...current, [tender.id]: { ...value, key } }));
    startTransition(async () => {
      const result = await staffIssueRefundAction({ organisationId, paymentId: tender.id, allocations: lines, reason: value.reason, externalReference: value.reference, idempotencyKey: key });
      setMessage(result.ok ? `Refund of ${money(amount)} recorded. Returned stock, if any, must be checked in separately.` : result.error);
      if (result.ok) {
        setSelection(current => ({ ...current, [sale.id]: {} }));
        setDetails(current => { const next = { ...current }; delete next[tender.id]; return next; });
        router.refresh();
      }
    });
  };

  const setQuantity = (sale: RecentSale, line: RefundableLine, raw: string) => {
    const parsed = Number(raw);
    const quantity = Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, line.refundableQuantity) : 0;
    setSelection(current => ({ ...current, [sale.id]: { ...current[sale.id], [line.orderItemId]: quantity } }));
  };

  return <section aria-label="Recent POS sales">
    <div className="section-heading"><div><span className="eyebrow">RECENT POS SALES</span><h2>Receipts and refunds</h2><p className="muted">Choose the exact items or service units to refund. The refund value is calculated from the original receipt.</p></div></div>
    {sales.length ? <div className="club-list">{sales.map(sale => {
      const chosen = selection[sale.id] ?? {};
      const estimate = refundSelectionTotal(sale.refundLines, chosen);
      return <article className="club-recent-sale" key={sale.id}>
        <div className="club-detail-row"><div><strong>{sale.customerName} · {money(sale.totalMinor)}</strong><small>{new Date(sale.createdAt).toLocaleString("en-GB")} · {sale.locationName} · {sale.status}</small><small>{sale.items.join(" · ") || "Sale items unavailable"}</small></div></div>
        <details className="club-refund-lines"><summary>Refund items</summary>
          {sale.refundLines.length ? <div className="club-list">{sale.refundLines.map(line => {
            const selected = chosen[line.orderItemId] ?? 0;
            const lineEstimate = refundLineAmount(line, selected);
            const disabled = line.refundableQuantity <= 0;
            return <div className="club-refund-line" key={line.orderItemId}>
              <div><strong>{line.productName}</strong><small>{line.kind === "service" ? `Service · ${line.unit}` : "Retail item"} · originally {line.quantity} · {money(line.saleValueMinor)} sale value</small>
                <small>{line.refundedQuantity > 0 || line.refundedMinor > 0 ? `Already refunded: ${line.refundedQuantity} ${line.unit} · ${money(line.refundedMinor)}. ` : ""}{line.kind === "service" ? "Only unused units can be returned. " : ""}{disabled ? "Nothing remains refundable." : `Up to ${line.refundableQuantity} ${line.unit} · ${money(line.refundableMinor)} eligible.`}{line.kind === "service" && line.refundableQuantity < (line.availableUnits ?? line.refundableQuantity) ? " Some unused units are not refundable because the remaining paid value is lower." : ""}</small>
              </div>
              <label>{line.kind === "service" ? "Units to refund" : "Quantity to refund"}
                <input aria-label={`${line.productName} quantity to refund`} type="number" inputMode="numeric" min="0" max={line.refundableQuantity} step="1" disabled={disabled} value={selected || ""} onChange={event => setQuantity(sale, line, event.target.value)} />
              </label>
              {selected > 0 ? <span className="muted">Refund value {money(lineEstimate)}</span> : null}
            </div>;
          })}</div> : <p className="muted">Line refund details are unavailable for this receipt.</p>}
        </details>
        {estimate > 0 ? <div className="club-refund-total"><span>Selected refund total</span><strong>{money(estimate)}</strong></div> : null}
        {sale.refunds.length ? <details className="club-refund-lines"><summary>Refund history</summary>{sale.refunds.map(refund => <div className="club-refund-history" key={refund.id}><strong>{money(refund.amountMinor)} · {methodName(refund.method)}</strong><small>{new Date(refund.createdAt).toLocaleString("en-GB")} · {refund.staffName} · {refund.reason}{refund.externalReference ? ` · Ref ${refund.externalReference}` : ""}</small><small>{refund.lines.map(item => `${item.name} × ${item.quantity} ${item.unit} (${money(item.amountMinor)})`).join(" · ") || "Line details unavailable"}</small></div>)}</details> : null}
        {sale.tenders.map(tender => {
          const detail = detailFor(tender.id);
          const payable = estimate > 0 && estimate <= tender.remainingMinor && tender.remainingMinor > 0;
          return <div className="club-detail-row" key={tender.id}><span><strong>{methodName(tender.method)} · {money(tender.amountMinor)}</strong><small>{tender.status} · {money(tender.remainingMinor)} remaining{tender.refundedMinor ? ` · ${money(tender.refundedMinor)} already refunded` : ""}</small>
            {estimate > tender.remainingMinor && tender.remainingMinor > 0 ? <small>This selection exceeds this payment’s remaining refundable amount. Each refund is recorded against one original tender; reduce the selection or use a single tender with enough remaining value.</small> : null}
            {payable ? <div className="club-profile-grid">
              <label>Reason<input aria-label="Refund reason" maxLength={240} value={detail.reason} onChange={event => setDetails(current => ({ ...current, [tender.id]: { ...detail, reason: event.target.value } }))} /></label>
              {tender.method !== "cash" && tender.method !== "balance" ? <label>Provider refund reference<input aria-label="Provider refund reference" maxLength={200} value={detail.reference} onChange={event => setDetails(current => ({ ...current, [tender.id]: { ...detail, reference: event.target.value } }))} /></label> : null}
              <button type="button" className="secondary" disabled={pending} onClick={() => submit(sale, tender)}>{pending ? "Recording…" : tender.method === "balance" ? "Refund to Balance" : tender.method === "cash" ? "Record cash refund" : "Record provider refund"}</button>
              <small>{tender.method === "balance" ? "The exact amount is credited to Madhouse Balance." : tender.method === "cash" ? "Return the cash before recording this refund." : "Refund externally first: complete the provider refund, then record its reference here."} Returned stock, if any, must be checked in separately.</small>
            </div> : null}
          </span></div>;
        })}
      </article>;
    })}</div> : <p className="muted">No completed POS sales to show yet.</p>}
    {message ? <p role="status" className="muted">{message}</p> : null}
  </section>;
}
