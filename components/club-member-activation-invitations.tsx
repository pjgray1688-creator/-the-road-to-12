"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sendMadhouseMemberInvitationsAction } from "@/app/club/members/activation/actions";

type InvitationRow = { id: string; display_name: string; masked_email: string; eligibility: string; state: string; invite_expires_at?: string | null; sendable: boolean };
type Preview = { members?: InvitationRow[]; eligible_count?: number; counts?: Record<string, number> };
const label: Record<string, string> = {
  eligible: "Ready to invite", already_linked: "Already linked", missing_email: "Email missing", invalid_email: "Invalid email",
  shared_or_placeholder: "Shared or placeholder email", shared_or_ambiguous_email: "Shared or ambiguous email", account_link_conflict: "Account linked elsewhere",
  queued: "Pending delivery", sent: "Invitation sent", completed: "Completed", expired: "Expired",
  failed: "Failed — can retry", exception: "Staff verification needed", revoked: "Revoked",
};

export function ClubMemberActivationInvitations({ organisationId, preview, deliveryReady }: { organisationId: string; preview: Preview; deliveryReady: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  const rows = preview.members ?? [];
  const sendable = rows.filter(row => row.sendable);

  const send = () => {
    if (!sendable.length || !deliveryReady) return;
    const approved = window.confirm(`Queue up to ${sendable.length} secure R12 activation invitations for currently eligible Active Madhouse members?\n\nThey will retain their existing membership. No payment, new membership or door access will be created.`);
    if (!approved) return;
    setMessage(undefined);
    startTransition(async () => {
      const result = await sendMadhouseMemberInvitationsAction({ organisationId, customerIds: sendable.map(row => row.id) });
      if (!result.ok) { setMessage(result.error); return; }
      setMessage(`${result.queued} invitation${result.queued === 1 ? "" : "s"} queued. ${result.skipped} member${result.skipped === 1 ? " was" : "s were"} skipped because eligibility changed or an invitation is already active.`);
      router.refresh();
    });
  };

  return <section aria-label="Existing member invitations">
    <div className="section-heading"><div><span className="eyebrow">DRY RUN · NO EMAIL SENT</span><h2>Invitation preview</h2><p className="muted">Only current Active gym memberships with a unique, usable email can be invited. Members must verify ownership of that exact email before their existing record is linked.</p></div></div>
    <div className="card-grid" aria-label="Invitation counts">
      <article className="card"><strong>{preview.eligible_count ?? 0}</strong><span>Eligible to invite</span></article>
      <article className="card"><strong>{preview.counts?.already_linked ?? 0}</strong><span>Already linked</span></article>
      <article className="card"><strong>{preview.counts?.missing_email ?? 0}</strong><span>Email missing</span></article>
      <article className="card"><strong>{(preview.counts?.invalid_email ?? 0) + (preview.counts?.shared_or_ambiguous_email ?? 0) + (preview.counts?.shared_or_placeholder ?? 0)}</strong><span>Shared or invalid email</span></article>
      <article className="card"><strong>{(preview.counts?.queued ?? 0) + (preview.counts?.sent ?? 0)}</strong><span>Pending or sent</span></article>
      <article className="card"><strong>{(preview.counts?.completed ?? 0)}</strong><span>Completed</span></article>
      <article className="card"><strong>{(preview.counts?.shared_or_ambiguous_email ?? 0) + (preview.counts?.shared_or_placeholder ?? 0) + (preview.counts?.account_link_conflict ?? 0) + (preview.counts?.exception ?? 0)}</strong><span>Staff verification needed</span></article>
    </div>
    <p className="muted">No invitation is sent until an authorised manager confirms below. The link expires after seven days. Existing membership history and payer arrangements remain unchanged; this does not request payment or enable physical door access.</p>
    {!deliveryReady ? <p role="status" className="muted">Sending is disabled until the invitation signing secret, email transport, worker credentials and the explicit invitation-delivery feature flag are configured.</p> : null}
    <button type="button" className="primary" disabled={pending || !deliveryReady || !sendable.length} onClick={send}>
      {pending ? "Queueing invitations…" : `Send invitations to ${sendable.length} eligible members`}
    </button>
    {message ? <p role="status">{message}</p> : null}
    <div className="table-scroll"><table><thead><tr><th>Member</th><th>Registered email</th><th>Status</th><th>Action</th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id}><td>{row.display_name}</td><td>{row.masked_email}</td><td>{label[row.state] ?? label[row.eligibility] ?? "Staff verification needed"}</td><td>{row.sendable ? "Eligible" : row.state === "exception" || row.eligibility === "shared_or_ambiguous_email" || row.eligibility === "account_link_conflict" || row.eligibility === "shared_or_placeholder" ? <Link href={`/club/members/customer/${encodeURIComponent(row.id)}?org=${encodeURIComponent(organisationId)}`}>Review member record</Link> : "—"}</td></tr>)}
      {!rows.length ? <tr><td colSpan={4}>No current Active membership records were found.</td></tr> : null}
    </tbody></table></div>
    <p className="muted">Shared household addresses, duplicate records, account conflicts, unverified addresses and linked memberships are held for staff review. Email alone never merges accounts.</p>
  </section>;
}
