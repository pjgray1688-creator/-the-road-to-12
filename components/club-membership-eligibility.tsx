"use client";

import { useState, useTransition } from "react";
import { verifyMembershipEligibilityAction } from "@/app/club/members/actions";

export function ClubMembershipEligibility({ organisationId, joinRequestId }: { organisationId: string; joinRequestId: string }) {
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const decide = (status: "approved" | "rejected") => startTransition(async () => {
    const result = await verifyMembershipEligibilityAction({ organisationId, joinRequestId, status, evidenceNote: note });
    setMessage(result.ok ? `Eligibility ${status}.` : result.error);
    if (result.ok) setNote("");
  });
  return <div className="membership-eligibility">
    <strong>Discount eligibility verification</strong>
    <p className="muted">Checkout remains unavailable until an authorised staff member records evidence and approves eligibility.</p>
    <label>Evidence note<input value={note} maxLength={500} onChange={event => setNote(event.target.value)} placeholder="Record the evidence checked" /></label>
    <div className="button-row"><button type="button" className="secondary" disabled={pending || note.trim().length < 3} onClick={() => decide("approved")}>Approve eligibility</button><button type="button" className="secondary" disabled={pending || note.trim().length < 3} onClick={() => decide("rejected")}>Reject</button></div>
    {message ? <p role="status" className="muted">{message}</p> : null}
  </div>;
}
