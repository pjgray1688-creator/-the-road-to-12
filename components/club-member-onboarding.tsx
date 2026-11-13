"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { assignMembershipAction, createClubCustomerAction, initiateMembershipCounterPaymentAction } from "@/app/club/members/actions";
import type { ClubProduct, ClubRole } from "@/lib/club";
import { membershipProducts } from "@/lib/club-membership-catalogue";
import styles from "./club-members-directory.module.css";

type MembershipCustomerOption = { id: string; displayName: string; email?: string; phone?: string };

const localDateTimeValue = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function ClubMemberOnboarding({ organisationId, customers, products, locations = [], role, canAssign: canAssignOverride }: { organisationId: string; organisationSlug: string; customers: MembershipCustomerOption[]; products: ClubProduct[]; locations?: Array<{ id: string; name: string }>; role: ClubRole; canAssign?: boolean }) {
  const [open, setOpen] = useState(false), [mode, setMode] = useState<"new" | "existing">("new"), [existingId, setExistingId] = useState(""), [memberQuery, setMemberQuery] = useState(""), [name, setName] = useState(""), [email, setEmail] = useState(""), [phone, setPhone] = useState(""), [productId, setProductId] = useState("");
  const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 10)), [endsAt, setEndsAt] = useState(""), [message, setMessage] = useState<string>(), [createdCustomerId, setCreatedCustomerId] = useState<string>();
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "external_card">("cash"), [locationId, setLocationId] = useState(locations[0]?.id ?? ""), [reference, setReference] = useState(""), [evidence, setEvidence] = useState("");
  const [paymentReceivedAt, setPaymentReceivedAt] = useState(localDateTimeValue), [terminalSuccess, setTerminalSuccess] = useState(false);
  const [pending, startTransition] = useTransition();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const canAssign = canAssignOverride ?? ["gym_admin", "owner"].includes(role);
  const assignableProducts = membershipProducts(products, canAssign, false).filter(product => !product.isLifetime);
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); startTransition(async () => {
    let customerId = existingId;
    if (!customerId) { const created = await createClubCustomerAction({ organisationId, displayName: name, email, phone: phone || undefined }); if (!created.ok) return setMessage(created.error); customerId = created.customerId; setCreatedCustomerId(customerId); setExistingId(customerId); }
    if (!productId) return setMessage(existingId ? "Choose a membership or pass." : "Person added. Choose a membership when payment details are ready.");
    const product = assignableProducts.find(item => item.id === productId);
    if (product?.pricingOnRequest) return setMessage("Family Membership needs negotiated terms from a sensitive-pricing manager before activation.");
    if (product && product.priceMinor > 0) { const payment = await initiateMembershipCounterPaymentAction({ organisationId, customerId, productId, locationId, method, externalReference: reference || undefined, terminalSuccessConfirmed: terminalSuccess, evidenceNote: evidence, startsAt, paymentReceivedAt, idempotencyKey }); setMessage(payment.ok ? payment.provisionalExpiresAt ? `Payment recorded. Provisional access expires ${new Date(payment.provisionalExpiresAt).toLocaleString("en-GB")} unless management reconciles it.` : "Bank transfer claim recorded for verification. Access has not been activated." : payment.error); if (payment.ok) setIdempotencyKey(crypto.randomUUID()); return; }
    const assigned = await assignMembershipAction({ organisationId, customerId, productId, startsAt, endsAt: endsAt || undefined, idempotencyKey });
    setMessage(assigned.ok ? "Membership recorded from the authorised product definition." : assigned.error); if (assigned.ok) { setProductId(""); setIdempotencyKey(crypto.randomUUID()); }
  }); };
  const selectedMember = customers.find(customer => customer.id === existingId);
  const memberMatches = !existingId && memberQuery.trim().length >= 2 ? customers.filter(customer => `${customer.displayName} ${customer.email ?? ""} ${customer.phone ?? ""}`.toLocaleLowerCase("en-GB").includes(memberQuery.trim().toLocaleLowerCase("en-GB"))).slice(0, 8) : [];
  return <section className={styles.onboarding}>
    <div className={styles.onboardingHead}><div><h2>Add or assign a membership</h2><p className="muted">Create a member record or assign a membership to an existing customer.</p></div><button type="button" className="primary" aria-expanded={open} onClick={() => { setOpen(value => !value); setMessage(undefined); }}>{open ? "Close form" : "Open membership form"}</button></div>
    {open ? <form className={styles.onboardingForm} onSubmit={submit}>
      <div className={styles.memberMode} role="group" aria-label="Member record type"><button type="button" className={mode === "new" ? "primary" : "secondary"} aria-pressed={mode === "new"} onClick={() => { setMode("new"); setExistingId(""); setMemberQuery(""); setMessage(undefined); }}>New member</button><button type="button" className={mode === "existing" ? "primary" : "secondary"} aria-pressed={mode === "existing"} onClick={() => { setMode("existing"); setMessage(undefined); }}>Existing member</button></div>
      {mode === "existing" ? <div className={styles.memberLookup}><label htmlFor="membership-customer-search">Find membership customer</label><input id="membership-customer-search" autoComplete="off" value={selectedMember?.displayName ?? memberQuery} onChange={event => { setExistingId(""); setMemberQuery(event.target.value); setMessage(undefined); }} placeholder="Search name, email or phone" />{memberMatches.length ? <div className={styles.memberResults} role="listbox" aria-label="Matching membership records">{memberMatches.map(customer => <button type="button" role="option" aria-selected={existingId === customer.id} key={customer.id} onClick={() => { setExistingId(customer.id); setMemberQuery(""); setMessage(undefined); }}>{customer.displayName}<small>{customer.email ?? customer.phone ?? "Membership record"}</small></button>)}</div> : memberQuery.trim().length >= 2 && !selectedMember ? <small>No matching membership records.</small> : null}</div> : <><label>Full name<input required value={name} onChange={event => setName(event.target.value)} /></label><label>Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" /></label><label>Phone <span className="muted">(optional)</span><input type="tel" value={phone} onChange={event => setPhone(event.target.value)} /></label></>}
      <label>Membership or pass<select value={productId} onChange={event => setProductId(event.target.value)} disabled={!canAssign}><option value="">{existingId ? "Choose a product" : "No membership yet"}</option>{assignableProducts.map(product => <option value={product.id} key={product.id}>{product.name} · {product.pricingOnRequest ? "Negotiated contract" : `£${(product.priceMinor / 100).toFixed(2)}`} · {product.billing}{product.durationDays ? ` · ${product.durationDays} days` : ""}</option>)}</select></label>
      <p className={styles.hint}>Paid memberships activate only after the separate authorised payment workflow confirms receipt. Family is a negotiated contract and is never a £0 purchase.</p>
      {assignableProducts.find(product => product.id === productId)?.priceMinor ? <><div className={styles.dateGrid}><label>Payment method<select value={method} onChange={event => { setMethod(event.target.value as typeof method); setTerminalSuccess(false); }}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="external_card">External card terminal/provider</option></select></label><label>Venue<select required value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">Choose venue</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label></div><label>Payment received / claimed at<input required type="datetime-local" value={paymentReceivedAt} onChange={event => setPaymentReceivedAt(event.target.value)} /></label><label>Receipt or transaction reference {method === "bank_transfer" ? null : <span className="muted">(optional)</span>}<input required={method === "bank_transfer"} value={reference} onChange={event => setReference(event.target.value)} /></label>{method === "external_card" ? <label><input type="checkbox" required checked={terminalSuccess} onChange={event => setTerminalSuccess(event.target.checked)} />I saw the external terminal show a successful payment</label> : null}<label>Payment note<textarea required minLength={8} placeholder="Steve paid £27 cash, deposited in Rotherham box." value={evidence} onChange={event => setEvidence(event.target.value)} /></label></> : null}
      <div className={styles.dateGrid}><label>Starts<input type="date" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>Ends <span className="muted">(calculated when fixed-term)</span><input type="date" value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label></div>
      <button type="submit" className="primary" disabled={pending || !canAssign || mode === "existing" && !existingId}>{pending ? "Saving…" : productId ? "Continue with membership" : "Add member record"}</button>
      {message ? <p className="muted" role="status">{message}{createdCustomerId ? <> <Link href={`/club/members/customer/${encodeURIComponent(createdCustomerId)}?org=${encodeURIComponent(organisationId)}`}>Open member record</Link>.</> : null}</p> : null}
    </form> : null}
  </section>;
}
