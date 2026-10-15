"use client";

import { useState, useTransition } from "react";
import { sendStaffEmailPreviewTest } from "@/app/club/staff/email-actions";

type Sample = "staff_owner" | "staff_coach" | "member_activation";
type Preview = { fromName: string; fromAddress: string; subject: string; destinationType: string; testPreview: boolean; text: string; html: string };

export function ClubEmailPreview({ organisationId, previews }: { organisationId: string; previews: Record<Sample, Preview> }) {
  const [sample, setSample] = useState<Sample>("staff_owner");
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const preview = previews[sample];
  return <div className="club-list">
    <label>Message preview<select value={sample} onChange={event => setSample(event.target.value as Sample)}><option value="staff_owner">Staff — Owner</option><option value="staff_coach">Staff — PT / Coach</option><option value="member_activation">Member activation</option></select></label>
    <p><strong>From name:</strong> {preview.fromName}<br /><strong>From address:</strong> {preview.fromAddress}<br /><strong>Subject:</strong> {preview.subject}<br /><strong>CTA destination:</strong> {preview.destinationType}<br /><strong>Preview:</strong> {preview.testPreview ? "Test preview — example data only" : "Live template"}</p>
    <h2>Email preview</h2><iframe title="Rendered R12 email preview" sandbox="" srcDoc={preview.html} style={{ width: "100%", minHeight: 520, border: "1px solid #443b50", borderRadius: 12, background: "white" }} />
    <details><summary>Plain-text version</summary><pre style={{ whiteSpace: "pre-wrap" }}>{preview.text}</pre></details>
    <form onSubmit={event => { event.preventDefault(); startTransition(async () => { const result = await sendStaffEmailPreviewTest({ organisationId, sample, recipient }); setMessage(result.ok ? `${result.message} ${result.from} · ${result.subject}` : result.error ?? "Test email could not be sent."); }); }}>
      <label>Send clearly marked test email to an allowlisted address<input type="email" required value={recipient} onChange={event => setRecipient(event.target.value)} autoComplete="email" /></label>
      <button className="secondary" type="submit" disabled={pending}>{pending ? "Sending…" : "Send test email"}</button>
    </form>
    {message ? <p role="status">{message}</p> : null}
    <p className="muted">Previews use example data only. This page does not create a staff grant, member record or notification outbox item. Test delivery is restricted to R12_EMAIL_TEST_RECIPIENTS.</p>
  </div>;
}
