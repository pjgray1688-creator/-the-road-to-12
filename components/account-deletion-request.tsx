"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { browserSupabase } from "@/lib/supabase-browser";
import { authAccountHref, authApps, type AuthApp } from "@/lib/auth-app";

type RequestState = { status: "none" | "requested" | "in_progress" | "completed" | "unable_to_complete"; execution_state?: "awaiting_review" | "awaiting_second_approval" | "approved" | "data_prepared" | "notification_pending" | "notification_sending" | "held" | "failed" | "completed"; requested_at?: string; response_due_at?: string; response_message?: string; completed_at?: string };

export function AccountDeletionRequest({ app }: { app: AuthApp }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [requestState, setRequestState] = useState<RequestState>({ status: "none" });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { data: { user } } = await browserSupabase().auth.getUser();
        if (!active) return;
        if (!user) { setLoading(false); return; }
        setEmail(user.email ?? "");
        const response = await fetch("/api/account/deletion-request", { cache: "no-store" });
        const data = response.ok ? await response.json() as RequestState : null;
        if (active && data) setRequestState(data);
        else if (active) setMessage("We couldn’t load your deletion request status. Try again shortly.");
      } catch {
        if (active) setMessage("We couldn’t load your account status. Check your connection and try again.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const submit = async () => {
    setMessage(""); setSaving(true);
    try {
      const response = await fetch("/api/account/deletion-request", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, confirmation }),
      });
      const result = await response.json().catch(() => ({})) as RequestState & { error?: string };
      if (!response.ok) { setMessage(result.error ?? "We couldn’t submit your request. Try again."); return; }
      setRequestState(result); setPassword(""); setConfirmation("");
      setMessage("Your account deletion request has been recorded.");
    } catch {
      setMessage("We couldn’t submit your request. Check your connection and try again.");
    } finally { setSaving(false); }
  };

  if (loading) return <p role="status">Checking your account…</p>;
  if (!email) return <><p>Sign in to the shared R12 account you want to delete. Deletion may affect access to every connected R12 application.</p><p>If you have a linked gym membership, recurring payment agreement or other service, deleting the account does not automatically cancel it.</p><Link className="primary" href={authAccountHref(app, "signIn", `/account/delete?app=${app}`)}>Sign in to continue</Link></>;
  if (requestState.status === "requested" || requestState.status === "in_progress") {
    const attention = requestState.execution_state === "held" || requestState.execution_state === "failed";
    const identityRemoved = requestState.execution_state === "notification_pending" || requestState.execution_state === "notification_sending";
    return <section aria-live="polite"><p className="eyebrow">{attention ? "OPERATOR REVIEW REQUIRED" : identityRemoved ? "ACCOUNT DELETED — NOTIFICATION PENDING" : requestState.status === "requested" ? "REQUEST RECORDED" : "IN REVIEW"}</p><p>Your request was recorded on {requestState.requested_at ? new Date(requestState.requested_at).toLocaleDateString("en-GB") : "your account"}. We will respond by {requestState.response_due_at ? new Date(requestState.response_due_at).toLocaleDateString("en-GB") : "within one calendar month"}. {identityRemoved ? "Your shared Auth identity has been removed, but completion notification has not yet been confirmed." : attention ? "Processing stopped safely and has not been marked complete." : "Your R12 account remains active until Auth identity removal is confirmed."}</p><p>If you have a linked gym membership, recurring payment agreement or other service, this request does not automatically cancel it. Manage cancellation separately with the organisation or provider responsible for that service.</p><p>Some transaction, payment, safety and audit records may need to be retained or anonymised under applicable legal requirements.</p>{requestState.response_message ? <p>{requestState.response_message}</p> : null}{message ? <p role="status">{message}</p> : null}</section>;
  }
  if (requestState.status === "completed") return <section aria-live="polite"><p className="eyebrow">REQUEST COMPLETED</p><p>{requestState.response_message ?? "Your account deletion request was completed"}{requestState.completed_at ? ` on ${new Date(requestState.completed_at).toLocaleDateString("en-GB")}` : ""}. Records required for legal or business purposes may remain access-controlled.</p></section>;
  if (requestState.status === "unable_to_complete") return <section aria-live="polite"><p className="eyebrow">REVIEW REQUIRED</p><p>{requestState.response_message ?? "Your request needs further review by the organisation. Your account remains active."}</p></section>;

  return <section className="account-deletion-request" aria-labelledby="account-deletion-title">
    <p>The request deletes your shared R12 account, not only your {authApps[app].name} access. It may affect access to every connected R12 application.</p>
    <p>If you have a linked gym membership, recurring payment agreement or other service, deleting the R12 account does not automatically cancel it. Manage cancellation separately with the organisation or provider responsible for that service.</p>
    <p>Your account stays active while the request is reviewed. Transaction, payment, safety and audit records may be retained or anonymised where required by law or for legitimate business records.</p>
    <p>We will review your request and respond within one calendar month. If a lawful extension is needed, we will explain why within that month.</p>
    <label>Confirm your account email<input type="email" value={email} readOnly autoComplete="username" /></label>
    <label>Current password<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" /></label>
    <label>Type DELETE to confirm<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label>
    <button className="primary" type="button" disabled={saving || !password || confirmation !== "DELETE"} onClick={() => void submit()}>{saving ? "Verifying and submitting…" : "Request account deletion"}</button>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
