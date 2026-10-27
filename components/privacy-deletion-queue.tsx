"use client";

import { useCallback, useEffect, useState } from "react";

type ExecutionState = "awaiting_review" | "awaiting_second_approval" | "approved" | "data_prepared" | "notification_pending" | "notification_sending" | "held" | "failed";
type DeletionRequest = { id: string; user_id: string; status: string; execution_state: ExecutionState; requested_at: string; response_due_at: string; response_message?: string | null; reviewer_name?: string | null; approver_name?: string | null; blockers?: unknown[] };
type RetentionCategory = "accounting" | "membership" | "transactions_refunds" | "safety" | "audit";
const categories: Array<{ key: RetentionCategory; label: string }> = [
  { key: "accounting", label: "Accounting records" }, { key: "membership", label: "Membership records" },
  { key: "transactions_refunds", label: "Transactions and refunds" }, { key: "safety", label: "Safety and safeguarding" },
  { key: "audit", label: "Audit evidence" },
];
const newDecisions = () => Object.fromEntries(categories.map(({ key }) => [key, { decision: "hold", rationale: "Retention decision requires documented operator review." }])) as Record<RetentionCategory, { decision: "retain" | "hold"; rationale: string }>;

export function PrivacyDeletionQueue() {
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [selected, setSelected] = useState<DeletionRequest | null>(null);
  const [responseMessage, setResponseMessage] = useState("We are reviewing your account deletion request and applicable record-retention requirements.");
  const [retentionDecisions, setRetentionDecisions] = useState(newDecisions);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/account/deletion-requests", { cache: "no-store" });
      const data = await response.json() as { requests?: DeletionRequest[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load privacy requests.");
      setRequests(data.requests ?? []); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load privacy requests."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);

  const actionFor = (item: DeletionRequest) => item.execution_state === "awaiting_review" || item.execution_state === "held"
    ? "review" : item.execution_state === "awaiting_second_approval" ? "approve" : item.execution_state === "notification_pending" ? "retry_notification" : item.execution_state === "notification_sending" ? "manual_reconciliation" : "execute";
  const action = selected ? actionFor(selected) : "review";
  const expectedConfirmation = action === "review" ? "REVIEW" : action === "approve" ? "APPROVE" : "EXECUTE";

  const submit = async () => {
    if (!selected) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/account/deletion-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        requestId: selected.id, action, responseMessage, retentionDecisions, password, confirmation,
      }) });
      const data = await response.json() as { error?: string; state?: string };
      if (!response.ok) throw new Error(data.error ?? "The deletion operation stopped safely.");
      setPassword(""); setConfirmation(""); setSelected(null); setMessage(data.state === "completed" ? "Deletion completed and audited." : data.state === "notification_pending" ? "The account identity is deleted, but notification failed. The request remains incomplete." : "The audited workflow advanced to its next state.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The deletion operation stopped safely."); }
    finally { setBusy(false); }
  };

  return <section className="privacy-deletion-queue" aria-labelledby="privacy-queue-title">
    <h2 id="privacy-queue-title">Account deletion operations</h2>
    <p>Two different named, allowlisted privacy operators must review and approve the same plan. This workflow deletes the shared Auth identity; it does not cancel memberships, coaching agreements, subscriptions or payment agreements.</p>
    <p>Unknown dependencies, unresolved retention decisions and restrictive business-record references stop execution. Failed or partial work remains visibly incomplete and is never silently retried.</p>
    {message ? <p role="status">{message}</p> : null}
    {requests.length ? <ul>{requests.map(item => <li key={item.id}><div><strong>{item.execution_state.replaceAll("_", " ")}</strong><span>Received {new Date(item.requested_at).toLocaleDateString("en-GB")} · due {new Date(item.response_due_at).toLocaleDateString("en-GB")}</span><code>Account reference {item.user_id}</code>{item.reviewer_name ? <span>Reviewed by {item.reviewer_name}{item.approver_name ? ` · approved by ${item.approver_name}` : ""}</span> : null}</div><button type="button" className="secondary" disabled={item.execution_state === "notification_sending"} onClick={() => { setSelected(item); setConfirmation(""); setPassword(""); if (actionFor(item) === "review") { setRetentionDecisions(newDecisions()); setResponseMessage("We are reviewing your account deletion request and applicable record-retention requirements."); } }}>{actionFor(item).replaceAll("_", " ")}</button></li>)}</ul> : <p>No open account deletion requests.</p>}
    {selected ? <div className="privacy-deletion-editor" role="dialog" aria-modal="true" aria-labelledby="privacy-request-editor-title">
      <h3 id="privacy-request-editor-title">{action.replaceAll("_", " ")} deletion request</h3>
      {action === "review" ? <><label>User-facing status<textarea maxLength={600} value={responseMessage} onChange={event => setResponseMessage(event.target.value)} /></label><fieldset><legend>Document every retention decision</legend>{categories.map(category => <div key={category.key} className="privacy-retention-decision"><strong>{category.label}</strong><label>Decision<select value={retentionDecisions[category.key].decision} onChange={event => setRetentionDecisions(current => ({ ...current, [category.key]: { ...current[category.key], decision: event.target.value as "retain" | "hold" } }))}><option value="hold">Hold for further review</option><option value="retain">Retain with restricted access</option></select></label><label>Documented rationale<textarea maxLength={500} value={retentionDecisions[category.key].rationale} onChange={event => setRetentionDecisions(current => ({ ...current, [category.key]: { ...current[category.key], rationale: event.target.value } }))} /></label></div>)}</fieldset></> : <p>{action === "approve" ? "Confirm that you are independent from the named reviewer and approve the unchanged plan." : "Run the approved exact-UUID deletion. The server will stop at any unreviewed dependency."}</p>}
      <label>Current password<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label>Type {expectedConfirmation} to confirm<input value={confirmation} autoComplete="off" onChange={event => setConfirmation(event.target.value)} /></label>
      <div><button type="button" className="secondary" disabled={busy} onClick={() => setSelected(null)}>Cancel</button> <button type="button" className="primary" disabled={busy || !password || confirmation !== expectedConfirmation} onClick={() => void submit()}>{busy ? "Working…" : `Confirm ${action.replaceAll("_", " ")}`}</button></div>
    </div> : null}
  </section>;
}
