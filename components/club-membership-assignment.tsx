"use client";

import { useState, useTransition } from "react";
import { assignMembershipAction, initiateMembershipCounterPaymentAction } from "@/app/club/members/actions";
import type { ClubProduct } from "@/lib/club";
import styles from "./club-members-directory.module.css";

const localDateTimeValue = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function ClubMembershipAssignment({ organisationId, userId, customerId, products, locations = [] }: { organisationId: string; organisationSlug: string; userId?: string; customerId?: string; products: ClubProduct[]; locations?: Array<{ id: string; name: string }> }) {
  const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [open, setOpen] = useState(false), [productId, setProductId] = useState(""), [startsAt, setStartsAt] = useState(localToday), [endsAt, setEndsAt] = useState(""), [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "external_card">("cash"), [locationId, setLocationId] = useState(locations[0]?.id ?? ""), [reference, setReference] = useState(""), [evidence, setEvidence] = useState("");
  const [paymentReceivedAt, setPaymentReceivedAt] = useState(localDateTimeValue), [terminalSuccess, setTerminalSuccess] = useState(false);
  const [grantType, setGrantType] = useState<"prepaid" | "complimentary">("prepaid"), [grantReason, setGrantReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const available = products.filter(product => product.kind === "membership" && !product.archivedAt && !product.isLifetime);
  const selected = available.find(product => product.id === productId);
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); startTransition(async () => {
    if (selected?.pricingOnRequest) return setMessage("Family Membership needs negotiated terms from a sensitive-pricing manager before activation.");
    const fixedTerm = Boolean(selected?.fixedTermValue && selected.fixedTermUnit);
    if (fixedTerm && grantReason.trim().length < 8) return setMessage("Record the prepaid evidence or complimentary approval reason.");
    if (!fixedTerm && selected && selected.priceMinor > 0 && customerId) { const payment = await initiateMembershipCounterPaymentAction({ organisationId, customerId, productId, locationId, method, externalReference: reference || undefined, terminalSuccessConfirmed: terminalSuccess, evidenceNote: evidence, startsAt, paymentReceivedAt, idempotencyKey }); setMessage(payment.ok ? payment.provisionalExpiresAt ? `Payment recorded. Provisional access expires ${new Date(payment.provisionalExpiresAt).toLocaleString("en-GB")} unless management reconciles it.` : "Bank transfer claim recorded for verification. Access has not been activated." : payment.error); if (payment.ok) setIdempotencyKey(crypto.randomUUID()); return; }
    const result = await assignMembershipAction({ organisationId, productId, customerId, holderUserIds: userId ? [userId] : [], startsAt, endsAt: endsAt || undefined, ...(fixedTerm ? { grantType, grantReason } : {}), idempotencyKey });
    setMessage(result.ok ? "Membership recorded from the authorised product definition." : result.error); if (result.ok) { setOpen(false); setIdempotencyKey(crypto.randomUUID()); }
  }); };
  return <div className={styles.assignment}>
    <p className={styles.hint}>Paid products require confirmed receipt before access can activate. Family pricing is restricted to authorised negotiated-contract management.</p>
    <button type="button" className="secondary" disabled={!available.length} onClick={() => setOpen(value => !value)}>{open ? "Close" : "Add membership or pass"}</button>
    {open ? <form className={styles.assignmentForm} onSubmit={submit}>
      <label>Membership or pass<select required value={productId} onChange={event => setProductId(event.target.value)}><option value="">Choose a product</option>{available.map(product => <option key={product.id} value={product.id}>{product.name} · {product.pricingOnRequest ? "Negotiated contract" : `£${(product.priceMinor / 100).toFixed(2)}`} · {product.fixedTermValue && product.fixedTermUnit ? `${product.fixedTermValue} ${product.fixedTermUnit}${product.fixedTermValue===1?"":"s"} · non-recurring` : product.billing}{product.durationDays ? ` · ${product.durationDays} days` : ""}</option>)}</select></label>
      {selected ? <p className={styles.hint}>{selected.pricingOnRequest ? "A sensitive-pricing holder must record the agreed Family terms first." : selected.fixedTermValue && selected.fixedTermUnit ? `Fixed term: ${selected.fixedTermValue} ${selected.fixedTermUnit}${selected.fixedTermValue===1?"":"s"}; one-off, with no subscription or mandate.` : selected.durationDays ? `Fixed term: ${selected.durationDays} days from the start date.` : "Renewal dates remain separate from actual payment receipt."}</p> : null}
      {selected?.fixedTermValue ? <><label>Issue as<select value={grantType} onChange={event => setGrantType(event.target.value as typeof grantType)}><option value="prepaid">Prepaid — payment already received and verified outside this assignment</option><option value="complimentary">Complimentary — authorised no-charge grant</option></select></label><label>Audit reason / payment evidence<textarea required minLength={8} maxLength={500} value={grantReason} onChange={event => setGrantReason(event.target.value)} placeholder="Record the verified prior payment or approval reason." /></label></> : null}
      {!selected?.fixedTermValue && selected && selected.priceMinor > 0 ? <><div className={styles.dateGrid}><label>Payment method<select value={method} onChange={event => { setMethod(event.target.value as typeof method); setTerminalSuccess(false); }}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="external_card">External card terminal/provider</option></select></label><label>Venue<select required value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">Choose venue</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label></div><label>Payment received / claimed at<input required type="datetime-local" value={paymentReceivedAt} onChange={event => setPaymentReceivedAt(event.target.value)} /></label><label>Receipt or transaction reference {method === "bank_transfer" ? null : <span className="muted">(optional)</span>}<input required={method === "bank_transfer"} value={reference} onChange={event => setReference(event.target.value)} /></label>{method === "external_card" ? <label><input type="checkbox" required checked={terminalSuccess} onChange={event => setTerminalSuccess(event.target.checked)} />I saw the external terminal show a successful payment</label> : null}<label>Payment note<textarea required minLength={8} placeholder="Steve paid £27 cash, deposited in Rotherham box." value={evidence} onChange={event => setEvidence(event.target.value)} /></label></> : null}
      <div className={styles.dateGrid}><label>Starts<input type="date" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>Ends <span className="muted">(optional)</span><input type="date" value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label></div>
      <button type="submit" className="primary" disabled={pending || !productId || Boolean(selected?.fixedTermValue && grantReason.trim().length < 8)}>{pending ? "Saving…" : selected?.fixedTermValue ? "Record fixed-term membership" : "Continue with membership"}</button>
      {message ? <p className="muted" role="status">{message}</p> : null}
    </form> : null}
  </div>;
}
