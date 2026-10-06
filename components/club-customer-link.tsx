"use client";
import { useState, useTransition } from "react";
import { linkClubCustomerAction } from "@/app/club/members/actions";

export function ClubCustomerLink({ organisationId, customerId }: { organisationId: string; customerId: string }) {
  const [message, setMessage] = useState<string>(); const [pending, startTransition] = useTransition();
  return <form style={{ display: "grid", gap: 10, marginTop: 14 }} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => { const result = await linkClubCustomerAction({ organisationId, customerId, targetEmail: String(form.get("targetEmail")), verificationMethod: String(form.get("verificationMethod")) as "photo_id" | "membership_reference" | "in_person", reason: String(form.get("reason")) }); setMessage(result.ok ? "Personal R12 account linked. Refreshing…" : result.error); if (result.ok) window.location.reload(); }); }}>
    <p className="muted">Use only after checking the person’s identity. The email must belong to an existing, verified R12 account.</p>
    <label>Verified R12 account email<input name="targetEmail" type="email" autoComplete="off" required /></label>
    <label>Identity check<select name="verificationMethod" required><option value="photo_id">Photo ID</option><option value="membership_reference">Membership reference and account details</option><option value="in_person">Known member verified in person</option></select></label>
    <label>Verification note<input name="reason" minLength={8} required placeholder="What was checked" /></label>
    <label><input type="checkbox" required />I have verified this is the member’s own R12 account</label>
    <button type="submit" className="secondary" disabled={pending}>{pending ? "Linking…" : "Link verified R12 account"}</button>{message ? <p className="muted" role="status">{message}</p> : null}
  </form>;
}
