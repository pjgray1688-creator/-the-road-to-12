"use client";

import { useState, useTransition } from "react";
import type { ClubProduct } from "@/lib/club";
import type { ClubRole } from "@/lib/club";
import type { ClubCustomer } from "@/lib/club-operations";
import { createClubCustomerAction, assignMembershipAction } from "@/app/club/members/actions";
import styles from "./club-members-directory.module.css";

const membershipProducts = (products: ClubProduct[]) => products.filter(product => product.kind === "membership" && !product.archivedAt);

export function ClubMemberOnboarding({ organisationId, customers, products, role }: { organisationId: string; customers: ClubCustomer[]; products: ClubProduct[]; role: ClubRole }) {
  const [open, setOpen] = useState(false);
  const [existingId, setExistingId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [productId, setProductId] = useState("");
  const [additionalHolderIds, setAdditionalHolderIds] = useState<string[]>([]);
  const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 10));
  const [endsAt, setEndsAt] = useState("");
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const selected = customers.find(customer => customer.id === existingId);
  const linkedUserId = selected?.userId;
  const canAssign = role === "gym_admin" || role === "owner";
  const reset = () => { setOpen(false); setExistingId(""); setName(""); setEmail(""); setProductId(""); setAdditionalHolderIds([]); setEndsAt(""); setMessage(undefined); };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      if (!existingId) {
        const result = await createClubCustomerAction({ organisationId, displayName: name, email: email || undefined });
        if (!result.ok) return setMessage(result.error);
        setMessage("Person added. Link their R12 account before assigning a membership.");
        return;
      }
      if (!linkedUserId) return setMessage("This person has no linked R12 account yet.");
      if (!canAssign) return setMessage("Person found. Membership assignment is limited to gym admins and owners.");
      if (!productId) return setMessage("Choose a membership or pass.");
      const result = await assignMembershipAction({ organisationId, productId, holderUserIds: [linkedUserId, ...additionalHolderIds], startsAt, endsAt: endsAt || undefined });
      if (!result.ok) return setMessage(result.error);
      setMessage("Membership assigned and benefits applied.");
    });
  };
  return <section className={styles.onboarding}><div className={styles.onboardingHead}><div><span className="eyebrow">ONBOARDING</span><h2>Add a person</h2><p className="muted">Find an existing customer or record a new walk-in.</p></div><button type="button" className="secondary" onClick={() => { setOpen(value => !value); setMessage(undefined); }}>{open ? "Close" : "Add member"}</button></div>{open ? <form className={styles.onboardingForm} onSubmit={submit}><label>Existing person<select value={existingId} onChange={event => { setExistingId(event.target.value); setAdditionalHolderIds([]); setMessage(undefined); }}><option value="">New person</option>{customers.map(customer => <option value={customer.id} key={customer.id}>{customer.displayName}{customer.email ? ` · ${customer.email}` : ""}</option>)}</select></label>{!existingId ? <><label>Name<input required value={name} onChange={event => setName(event.target.value)} placeholder="Full name" /></label><label>Email <span className="muted">(optional)</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" /></label><p className={styles.hint}>People without an R12 account are recorded as guests. No credentials are created here.</p></> : <><p className={styles.hint}>{linkedUserId ? canAssign ? "Linked R12 account found. You can assign a membership below." : "Linked R12 account found. Membership assignment is limited to gym admins and owners." : "No linked R12 account yet. Add the person now, then link their account before assigning a membership."}</p><label>Membership or pass<select value={productId} onChange={event => setProductId(event.target.value)} disabled={!linkedUserId || !canAssign}><option value="">Choose a product</option>{membershipProducts(products).map(product => <option value={product.id} key={product.id}>{product.name} · £{(product.priceMinor / 100).toFixed(2)}</option>)}</select></label>{canAssign && customers.some(customer => customer.userId && customer.userId !== linkedUserId) ? <fieldset className={styles.holders}><legend>Additional holders <span className="muted">(optional)</span></legend>{customers.filter(customer => customer.userId && customer.userId !== linkedUserId).map(customer => <label key={customer.id}><input type="checkbox" checked={additionalHolderIds.includes(customer.userId!)} onChange={event => setAdditionalHolderIds(current => event.target.checked ? [...current, customer.userId!] : current.filter(id => id !== customer.userId))} />{customer.displayName}</label>)}</fieldset> : null}<div className={styles.dateGrid}><label>Starts<input type="date" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>Ends <span className="muted">(optional)</span><input type="date" value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label></div></>}<button type="submit" className="primary" disabled={pending}>{pending ? "Saving…" : existingId && canAssign ? "Assign membership" : "Add person"}</button>{message ? <p className="muted" role="status">{message}</p> : null}</form> : null}</section>;
}
