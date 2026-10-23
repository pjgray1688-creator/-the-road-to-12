"use client";
import { PasswordInput } from "@/components/password-input";

import { useCallback, useEffect, useState } from "react";

type DeletionRequest = {
  id: string; user_id: string; status: "requested" | "in_progress"; requested_at: string;
  response_due_at: string; response_message?: string | null;
};

export function PrivacyDeletionQueue() {
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [selected, setSelected] = useState<DeletionRequest | null>(null);
  const [status, setStatus] = useState<"in_progress" | "completed" | "unable_to_complete">("in_progress");
  const [responseMessage, setResponseMessage] = useState("We have received your request and are reviewing the information and retention requirements. We will respond within one calendar month of receipt.");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [retentionReviewed, setRetentionReviewed] = useState(false);
  const [eligibleDataProcessed, setEligibleDataProcessed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/account/deletion-requests", { cache: "no-store" });
      const data = await response.json() as { requests?: DeletionRequest[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load privacy requests.");
      setRequests(data.requests ?? []); setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load privacy requests.");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load, loadAttempt]);

  const updateRequest = async () => {
    if (!selected) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/account/deletion-requests", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: selected.id, status, responseMessage, password, confirmation, retentionReviewed, eligibleDataProcessed }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not update this request.");
      setPassword(""); setConfirmation(""); setRetentionReviewed(false); setEligibleDataProcessed(false); setSelected(null);
      setMessage("Request updated and recorded in the audit trail."); await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update this request.");
    } finally { setBusy(false); }
  };

  return <section className="privacy-deletion-queue" aria-labelledby="privacy-queue-title">
    <h2 id="privacy-queue-title">Open account deletion requests</h2>
    <p>Verify identity, review linked services and retention obligations, then remove or anonymise data eligible for erasure through the approved service workflows. Never erase payment, financial, safety, safeguarding or audit evidence that must be retained. Do not cancel memberships or payment agreements from this queue.</p>
    <p>Respond within one calendar month of receipt. If a lawful extension is necessary because the request is complex or repeated, notify the person within the first month and explain why.</p>
    {message ? <p role="status">{message} {requests.length === 0 && message ? <button type="button" onClick={() => setLoadAttempt(value => value + 1)}>Retry</button> : null}</p> : null}
    {requests.length ? <ul>{requests.map(item => <li key={item.id}>
      <div><strong>{item.status === "requested" ? "New request" : "In review"}</strong><span>Received {new Date(item.requested_at).toLocaleDateString("en-GB")} · response due {new Date(item.response_due_at).toLocaleDateString("en-GB")}</span><code>Account reference {item.user_id}</code></div>
      <button type="button" className="secondary" onClick={() => { setSelected(item); setStatus("in_progress"); setResponseMessage("We have received your request and are reviewing the information and retention requirements. We will respond within one calendar month of receipt."); }}>Review request</button>
    </li>)}</ul> : <p>No open account deletion requests.</p>}
    {selected ? <div className="privacy-deletion-editor" role="dialog" aria-modal="true" aria-labelledby="privacy-request-editor-title">
      <h3 id="privacy-request-editor-title">Update request</h3>
      <label>Outcome<select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="in_progress">Keep in review</option><option value="completed">Confirm processing completed</option><option value="unable_to_complete">Needs further review</option></select></label>
      <label>User-facing response<textarea value={responseMessage} maxLength={600} onChange={event => setResponseMessage(event.target.value)} /></label>
      {status === "completed" ? <div className="privacy-deletion-attestations"><label><input type="checkbox" checked={retentionReviewed} onChange={event => setRetentionReviewed(event.target.checked)} /> I reviewed the applicable retention requirements and restricted records that must remain.</label><label><input type="checkbox" checked={eligibleDataProcessed} onChange={event => setEligibleDataProcessed(event.target.checked)} /> I processed the eligible data for erasure or anonymisation through approved systems, including the account identity as appropriate.</label></div> : null}
      <label>Current password<PasswordInput autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label>Type PROCESS to confirm<input value={confirmation} autoComplete="off" onChange={event => setConfirmation(event.target.value)} /></label>
      <div><button type="button" className="secondary" disabled={busy} onClick={() => setSelected(null)}>Cancel</button> <button type="button" className="primary" disabled={busy || !password || confirmation !== "PROCESS" || !responseMessage.trim() || (status === "completed" && (!retentionReviewed || !eligibleDataProcessed))} onClick={() => void updateRequest()}>{busy ? "Saving…" : "Save audited update"}</button></div>
    </div> : null}
  </section>;
}
