"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { setMembershipHouseholdMemberAction } from "@/app/club/members/actions";

type Holder = { customerId: string; displayName: string; billingContact: boolean };
type Candidate = { id: string; displayName: string };

export function ClubMembershipHousehold({ organisationId, membershipId, holders, candidates, canManage }: {
  organisationId: string; membershipId: string; holders: Holder[]; candidates: Candidate[]; canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const available = useMemo(() => candidates.filter(person => !holders.some(holder => holder.customerId === person.id)), [candidates, holders]);
  if (holders.length < 2 && !canManage) return null;
  const change = (customerId: string, action: "add" | "remove") => {
    if (reason.trim().length < 3) { setMessage("Add a short reason before saving."); return; }
    startTransition(async () => {
      const result = await setMembershipHouseholdMemberAction({ organisationId, membershipId, customerId, action, reason });
      setMessage(result.ok ? action === "add" ? "Family member added to this shared membership." : "Family member removed. The membership remains active for its other holders." : result.error ?? "Membership holders couldn’t be updated.");
      if (result.ok) { setReason(""); setSelected(""); router.refresh(); }
    });
  };
  return <section className="membership-household" aria-label="Shared membership holders">
    <strong>Shared membership</strong>
    {holders.length ? holders.map(holder => <div className="club-detail-row" key={holder.customerId}>
      <span>{holder.displayName}{holder.billingContact ? <small>Billing contact</small> : null}</span>
      {canManage ? <button type="button" className="secondary" disabled={pending || holder.billingContact || holders.length <= 1} title={holder.billingContact ? "Resolve billing ownership before removing the billing contact" : undefined} onClick={() => change(holder.customerId, "remove")}>Remove</button> : null}
    </div>) : <p className="muted">No other household holders are linked yet.</p>}
    {canManage ? <><label>Add an existing person<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">Choose a person</option>{available.map(person => <option key={person.id} value={person.id}>{person.displayName}</option>)}</select></label><label>Reason<input value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="For example, household member verified at reception" /></label><button type="button" className="secondary" disabled={pending || !selected || reason.trim().length < 3} onClick={() => change(selected, "add")}>Add to shared membership</button></> : null}
    {message ? <p role="status" className="muted">{message}</p> : null}
  </section>;
}
