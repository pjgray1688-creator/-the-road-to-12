"use client";

import { useState, useTransition } from "react";
import { verifyMembershipCounterPaymentAction } from "@/app/club/members/actions";

export function ClubMembershipPaymentReview({ organisationId, paymentId }: { organisationId: string; paymentId: string }) {
  const [note, setNote] = useState(""); const [message, setMessage] = useState(""); const [pending, startTransition] = useTransition();
  const decide = (decision: "confirmed" | "rejected") => startTransition(async () => { const result = await verifyMembershipCounterPaymentAction({ organisationId, paymentId, decision, verificationNote: note }); setMessage(result.ok ? decision === "confirmed" ? "Payment confirmed and membership activated." : "Payment evidence rejected; no access was activated." : result.error ?? "Decision could not be saved."); });
  return <div><label>Verification note<textarea required minLength={8} value={note} onChange={event => setNote(event.target.value)} /></label><div className="button-row"><button className="primary" type="button" disabled={pending || note.trim().length < 8} onClick={() => decide("confirmed")}>Confirm verified payment</button><button className="secondary" type="button" disabled={pending || note.trim().length < 8} onClick={() => decide("rejected")}>Reject evidence</button></div>{message ? <p role="status" className="muted">{message}</p> : null}</div>;
}
