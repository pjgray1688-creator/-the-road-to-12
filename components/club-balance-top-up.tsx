"use client";
import { useState, useTransition } from "react";
import type { ClubCustomer } from "@/lib/club-operations";
import { topUpBalanceAction } from "@/app/club/shop/actions";

export function ClubBalanceTopUp({ organisationId, locationId, customers }: { organisationId: string; locationId?: string; customers: ClubCustomer[] }) {
  const [customerId, setCustomerId] = useState(""); const [amount, setAmount] = useState(""); const [message, setMessage] = useState<string>(); const [pending, startTransition] = useTransition();
  const submit = () => startTransition(async () => { if (!locationId) { setMessage("Choose a location first."); return; } const result = await topUpBalanceAction({ organisationId, locationId, customerId, amount }); setMessage(result.ok ? `Balance updated to £${(result.balanceMinor / 100).toFixed(2)}.` : result.error); if (result.ok) setAmount(""); });
  return <section className="staff-checkout" aria-label="Madhouse Balance top up"><div className="section-heading"><div><span className="eyebrow">MADHOUSE BALANCE</span><h2>Quick top up</h2><p className="muted">Record cash for a linked member. Walk-in customers cannot hold balance.</p></div></div><label>Member<select value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">Select a member</option>{customers.filter(customer => customer.userId).map(customer => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}</select></label><label>Cash amount<input value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" /></label><button type="button" className="primary" onClick={submit} disabled={pending || !customerId || !locationId}>{pending ? "Recording…" : "Confirm cash top up"}</button>{message ? <p role="status">{message}</p> : null}</section>;
}
