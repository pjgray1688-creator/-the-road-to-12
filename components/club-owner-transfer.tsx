"use client";

import { useState, useTransition } from "react";
import { transferOrganisationOwner } from "@/app/club/staff/actions";

type Candidate = { userId: string; name: string; role: string };

export function ClubOwnerTransfer({ organisationId, candidates }: { organisationId: string; candidates: Candidate[] }) {
  const [target, setTarget] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const ready = target && confirmation === "TRANSFER OWNERSHIP" && !pending;
  return <section aria-label="Transfer organisation ownership" className="card">
    <span className="eyebrow">OWNER CONTROL</span><h2>Transfer ownership</h2>
    <p className="muted">The selected active organisation member becomes Owner. You become Manager. Coach access, venue links, memberships and entitlements remain unchanged. Only do this after launch testing is complete.</p>
    <label>New Owner<select value={target} onChange={event => setTarget(event.target.value)}><option value="">Select an active person</option>{candidates.map(candidate => <option key={candidate.userId} value={candidate.userId}>{candidate.name} · {candidate.role}</option>)}</select></label>
    <label>Type TRANSFER OWNERSHIP to confirm<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label>
    <button type="button" className="secondary" disabled={!ready} onClick={() => startTransition(async () => { const result = await transferOrganisationOwner(organisationId, target); setMessage(result.ok ? "Ownership transferred. You now have Manager access." : result.error ?? "Ownership could not be transferred."); })}>{pending ? "Transferring…" : "Transfer ownership"}</button>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
