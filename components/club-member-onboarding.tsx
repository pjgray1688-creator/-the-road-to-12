"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { assignMembershipAction, createClubCustomerAction, initiateMembershipCounterPaymentAction } from "@/app/club/members/actions";
import type { ClubProduct, ClubRole } from "@/lib/club";
import { membershipProducts } from "@/lib/club-membership-catalogue";
import type { ClubCustomer } from "@/lib/club-operations";
import styles from "./club-members-directory.module.css";

export function ClubMemberOnboarding({ organisationId, customers, products, locations = [], role, canAssign: canAssignOverride }: { organisationId: string; organisationSlug: string; customers: ClubCustomer[]; products: ClubProduct[]; locations?: Array<{ id: string; name: string }>; role: ClubRole; canAssign?: boolean }) {
  const [open, setOpen] = useState(false), [existingId, setExistingId] = useState(""), [name, setName] = useState(""), [email, setEmail] = useState(""), [phone, setPhone] = useState(""), [productId, setProductId] = useState("");
  const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 10)), [endsAt, setEndsAt] = useState(""), [message, setMessage] = useState<string>(), [createdCustomerId, setCreatedCustomerId] = useState<string>();
  const [method, setMethod] = useState<"cash" | "bank_transfer" | "external_card">("cash"), [locationId, setLocationId] = useState(locations[0]?.id ?? ""), [reference, setReference] = useState(""), [evidence, setEvidence] = useState("");
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
    if (product && product.priceMinor > 0) { const payment = await initiateMembershipCounterPaymentAction({ organisationId, customerId, productId, locationId, method, externalReference: reference || undefined, evidenceNote: evidence, startsAt, idempotencyKey }); setMessage(payment.ok ? "Payment evidence recorded for independent verification. No access is active yet." : payment.error); if (payment.ok) setIdempotencyKey(crypto.randomUUID()); return; }
    const assigned = await assignMembershipAction({ organisationId, customerId, productId, startsAt, endsAt: endsAt || undefined, idempotencyKey });
    setMessage(assigned.ok ? "Membership recorded from the authorised product definition." : assigned.error); if (assigned.ok) { setProductId(""); setIdempotencyKey(crypto.randomUUID()); }
  }); };
  return <section className={styles.onboarding}>
    <div className={styles.onboardingHead}><p className="muted">Add a new member or update an existing member, then use an authorised payment or contract workflow.</p><button type="button" className="secondary" onClick={() => setOpen(value => !value)}>{open ? "Close" : "Add or update member"}</button></div>
    {open ? <form className={styles.onboardingForm} onSubmit={submit}>
      <label>Member<select value={existingId} onChange={event => { setExistingId(event.target.value); setMessage(undefined); }}><option value="">New member</option>{customers.map(customer => <option value={customer.id} key={customer.id}>{customer.displayName}{customer.email ? ` · ${customer.email}` : ""}</option>)}</select></label>
      {!existingId ? <><label>Full name<input required value={name} onChange={event => setName(event.target.value)} /></label><label>Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" /></label><label>Phone <span className="muted">(optional)</span><input type="tel" value={phone} onChange={event => setPhone(event.target.value)} /></label></> : null}
      <label>Membership or pass<select value={productId} onChange={event => setProductId(event.target.value)} disabled={!canAssign}><option value="">{existingId ? "Choose a product" : "No membership yet"}</option>{assignableProducts.map(product => <option value={product.id} key={product.id}>{product.name} · {product.pricingOnRequest ? "Negotiated contract" : `£${(product.priceMinor / 100).toFixed(2)}`} · {product.billing}{product.durationDays ? ` · ${product.durationDays} days` : ""}</option>)}</select></label>
      <p className={styles.hint}>Paid memberships activate only after the separate authorised payment workflow confirms receipt. Family is a negotiated contract and is never a £0 purchase.</p>
      {assignableProducts.find(product => product.id === productId)?.priceMinor ? <><div className={styles.dateGrid}><label>Payment method<select value={method} onChange={event => setMethod(event.target.value as typeof method)}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="external_card">External card terminal/provider</option></select></label><label>Venue<select required value={locationId} onChange={event => setLocationId(event.target.value)}><option value="">Choose venue</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label></div><label>Receipt or external reference {method === "cash" ? <span className="muted">(optional)</span> : null}<input required={method !== "cash"} value={reference} onChange={event => setReference(event.target.value)} /></label><label>Payment evidence note<textarea required minLength={8} value={evidence} onChange={event => setEvidence(event.target.value)} /></label></> : null}
      <div className={styles.dateGrid}><label>Starts<input type="date" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>Ends <span className="muted">(calculated when fixed-term)</span><input type="date" value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label></div>
      <button type="submit" className="primary" disabled={pending || !canAssign}>{pending ? "Saving…" : productId ? "Continue with membership" : "Add member record"}</button>
      {message ? <p className="muted" role="status">{message}{createdCustomerId ? <> <Link href={`/club/members/customer/${encodeURIComponent(createdCustomerId)}?org=${encodeURIComponent(organisationId)}`}>Open member record</Link>.</> : null}</p> : null}
    </form> : null}
  </section>;
}
