"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { extendMembershipPaymentGraceAction } from "@/app/club/members/actions";
import { graceArrangementState, type GraceExtensionContext } from "@/lib/club-payment-grace";
import styles from "./club-membership-grace-extension.module.css";

const dateTime = (value: string) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const money = (minor: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);

export function ClubMembershipGraceExtension({ organisationId, context }: { organisationId: string; context: GraceExtensionContext }) {
  const router = useRouter();
  const [newExpiry, setNewExpiry] = useState("");
  const [agreedPaymentDate, setAgreedPaymentDate] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const arrangementState = graceArrangementState(context);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(undefined);
    startTransition(async () => {
      const result = await extendMembershipPaymentGraceAction({
        organisationId,
        obligationId: context.obligationId,
        newGraceExpiresAt: new Date(newExpiry).toISOString(),
        agreedPaymentDate: agreedPaymentDate || undefined,
        reason,
        idempotencyKey: crypto.randomUUID(),
      });
      setMessage(result.ok ? "Payment grace extended. The payment remains outstanding." : result.error);
      if (result.ok) {
        setNewExpiry("");
        setAgreedPaymentDate("");
        setReason("");
        router.refresh();
      }
    });
  }

  return <section className={styles.panel} aria-label="Payment grace arrangement">
    <div className={styles.summary}>
      <strong>{arrangementState}</strong>
      <span className="muted">{money(context.amountMinor, context.currency)} remains unpaid. Extending grace does not change the due date, collection schedule or provider retries.</span>
    </div>
    <div className={styles.facts}>
      <span><small>Original due</small>{dateTime(context.originalDueAt)}</span>
      <span><small>Original grace</small>{dateTime(context.originalGraceExpiresAt)}</span>
      <span><small>Current grace</small>{dateTime(context.currentGraceExpiresAt)}</span>
      <span><small>Extensions</small>{context.extensionCount}</span>
    </div>
    <p className="muted">Covered together: {context.coveredHolders.map(holder => holder.displayName).join(", ") || "membership holder"}.</p>
    {context.eligible ? <form className={styles.form} onSubmit={submit}>
      <label>New grace expiry<input type="datetime-local" required value={newExpiry} onChange={event => setNewExpiry(event.target.value)} /></label>
      <label>Agreed payment date <span className="muted">(optional, if different)</span><input type="date" value={agreedPaymentDate} onChange={event => setAgreedPaymentDate(event.target.value)} /></label>
      <label>Reason for extension<textarea required minLength={8} maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} /></label>
      <button type="submit" className="secondary" disabled={pending || !newExpiry || reason.trim().length < 8}>{pending ? "Saving…" : "Authorise grace extension"}</button>
    </form> : null}
    {context.history.length ? <details className={styles.history}><summary>Extension history ({context.history.length})</summary><ul>{context.history.map(item => <li key={item.id}>
      <strong>Extension {item.sequence} · to {dateTime(item.newGraceExpiresAt)}</strong>
      <small>Approved by {item.approvedByName} on {dateTime(item.approvedAt)}{item.agreedPaymentDate ? ` · payment agreed ${new Date(`${item.agreedPaymentDate}T12:00:00`).toLocaleDateString("en-GB")}` : ""}</small>
      <small>Covered at approval: {item.coveredHolders.map(holder => holder.displayName).join(", ")}</small>
      <span>{item.reason}</span>{item.closedAt ? <small>Closed after payment recovery {dateTime(item.closedAt)}</small> : null}
    </li>)}</ul></details> : null}
    {message ? <p role="status" className="muted">{message}</p> : null}
  </section>;
}
