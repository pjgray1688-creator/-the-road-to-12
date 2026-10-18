"use client";
import { useState, useTransition } from "react";
import { verifyMemberPersonalEmailAction } from "@/app/club/members/actions";

export function ClubMemberPersonalEmailVerification({ organisationId, customerId, currentEmail }: { organisationId: string; customerId: string; currentEmail?: string }) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  return <form style={{ display: "grid", gap: 10, marginTop: 12 }} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => { const result = await verifyMemberPersonalEmailAction({ organisationId, customerId, email: String(form.get("email") ?? ""), method: String(form.get("method")) as "in_person" | "member_confirmed", note: String(form.get("note") ?? "") }); setMessage(result.ok ? "Personal email verification recorded. You may now queue account activation." : result.error ?? "Verification could not be recorded."); }); }}>
    <p className="muted">{currentEmail ? "Only continue after confirming this inbox belongs to this member personally. A Club Manager email match is not proof. If this is a parent’s or partner’s shared address, enter the member’s own address instead." : "No email is recorded. Help the member enter an address they personally control. Never use a payer’s shared email for their individual activation."}</p>
    <label>Member’s personal email<input name="email" type="email" defaultValue={currentEmail ?? ""} required /></label>
    <label>How was control confirmed?<select name="method" defaultValue="member_confirmed"><option value="member_confirmed">Member confirmed their own inbox</option><option value="in_person">Member demonstrated inbox access in person</option></select></label>
    <label>Verification note<input name="note" minLength={8} maxLength={500} required placeholder="What the member confirmed" /></label>
    <label><input type="checkbox" required />I confirmed this is the member’s own personal email, not a shared payer address</label>
    <button className="secondary" type="submit" disabled={pending}>{pending ? "Recording…" : "Verify personal email"}</button>{message && <p role="status" className="muted">{message}</p>}
  </form>;
}
