"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reconcileCashAction } from "@/app/club/shop/actions";
import type { ClubCashDeclaration } from "@/lib/club-commercial-rules";
import { cashDiscrepancyMinor, parseMinorUnits } from "@/lib/club-money";

const money = (minor: number) => `£${(minor / 100).toFixed(2)}`;

export function ClubCashDeclarationReview({ organisationId, declarations, locations }: { organisationId: string; declarations: ClubCashDeclaration[]; locations: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [selected, setSelected] = useState<ClubCashDeclaration>();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const discrepancyInput = parseMinorUnits(counted);
  const reconcile = (item: ClubCashDeclaration, status: "confirmed" | "rejected" | "discrepancy", discrepancyMinor?: number) => startTransition(async () => {
    const result = await reconcileCashAction({ organisationId, declarationId: item.id, status, discrepancyMinor, notes: note.trim() || undefined });
    setMessage(result.ok ? "Cash declaration updated." : result.error);
    if (result.ok) { setSelected(undefined); setCounted(""); setNote(""); router.refresh(); }
  });
  return <section className="club-cash-review" aria-label="Cash declarations awaiting review">
    <h2>Cash declarations to review</h2>
    {declarations.length ? <div className="club-cash-review-list">{declarations.map(item => <article key={item.id}>
      <div><strong>{item.memberDisplayName ?? "Member/customer"} · {money(item.declaredAmountMinor)}</strong><span>{item.productSummary ?? item.purpose.replaceAll("_", " ")} · {locations.find(location => location.id === item.locationId)?.name ?? "Location not set"} · {new Date(item.declaredAt).toLocaleString("en-GB")}</span></div>
      <div className="club-cash-review-actions"><button type="button" className="primary" disabled={pending} onClick={() => reconcile(item, "confirmed")}>Confirm</button><button type="button" className="secondary" disabled={pending} onClick={() => { setSelected(item); setCounted(""); setNote(""); setMessage(""); }}>Record discrepancy</button><button type="button" className="secondary" disabled={pending} onClick={() => reconcile(item, "rejected")}>Reject</button></div>
    </article>)}</div> : <p>No cash declarations are waiting for review.</p>}
    {message ? <p role="status">{message}</p> : null}
    {selected ? <div className="club-cash-review-dialog" role="dialog" aria-modal="true" aria-label="Record cash discrepancy"><div><h3>Record discrepancy</h3><p>Declared {money(selected.declaredAmountMinor)} at {locations.find(location => location.id === selected.locationId)?.name ?? "the selected location"}.</p><label>Cash counted (£)<input inputMode="decimal" value={counted} onChange={event => setCounted(event.target.value)} /></label><label>Review note<input value={note} onChange={event => setNote(event.target.value)} maxLength={240} /></label><div><button type="button" className="primary" disabled={pending || discrepancyInput === undefined} onClick={() => { const difference = cashDiscrepancyMinor(selected.declaredAmountMinor, counted); if (difference === undefined) return; reconcile(selected, "discrepancy", difference); }}>Save review</button><button type="button" className="secondary" disabled={pending} onClick={() => setSelected(undefined)}>Cancel</button></div></div></div> : null}
  </section>;
}
