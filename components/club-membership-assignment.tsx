"use client";

import { useState, useTransition } from "react";
import type { ClubProduct } from "@/lib/club";
import { assignMembershipAction } from "@/app/club/members/actions";
import styles from "./club-members-directory.module.css";

export function ClubMembershipAssignment({ organisationId, userId, products }: { organisationId: string; userId: string; products: ClubProduct[] }) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [startsAt, setStartsAt] = useState(new Date().toISOString().slice(0, 10));
  const [endsAt, setEndsAt] = useState("");
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const membershipProducts = products.filter(product => product.kind === "membership" && !product.archivedAt);
  const selectedProduct = membershipProducts.find(product => product.id === productId);
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); startTransition(async () => { const result = await assignMembershipAction({ organisationId, productId, holderUserIds: [userId], startsAt, endsAt: endsAt || undefined }); setMessage(result.ok ? "Membership assigned and benefits applied." : result.error); if (result.ok) setOpen(false); }); };
  return <div className={styles.assignment}><button type="button" className="secondary" onClick={() => { setOpen(value => !value); setMessage(undefined); }}>{open ? "Close" : "Assign membership"}</button>{open ? <form className={styles.assignmentForm} onSubmit={submit}><label>Membership or pass<select required value={productId} onChange={event => setProductId(event.target.value)}><option value="">Choose a product</option>{membershipProducts.map(product => <option key={product.id} value={product.id}>{product.name} · £{(product.priceMinor / 100).toFixed(2)} · {product.billing}{product.durationDays ? ` · ${product.durationDays} days` : ""}</option>)}</select></label>{selectedProduct ? <p className={styles.hint}>{selectedProduct.durationDays ? `Fixed term: ${selectedProduct.durationDays} days from the start date.` : selectedProduct.billing === "recurring" ? "Recurring membership; payment is recorded separately." : "One-off membership; payment is recorded separately."}</p> : null}<div className={styles.dateGrid}><label>Starts<input type="date" required value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label><label>Ends <span className="muted">(optional)</span><input type="date" value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label></div><p className={styles.hint}>Benefits are applied from the saved product definition. Existing history is kept.</p><button type="submit" className="primary" disabled={pending || !productId}>{pending ? "Saving…" : "Confirm assignment"}</button>{message ? <p className="muted" role="status">{message}</p> : null}</form> : null}</div>;
}
