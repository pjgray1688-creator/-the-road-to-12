"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { retryJoinPaymentAction, startClubJoiningAction, type JoiningActionResult } from "@/app/club/join/actions";
import styles from "@/components/club-members-directory.module.css";

type Product = { id: string; name: string; priceMinor: number; billing: string; durationDays?: number };
type Location = { id: string; name: string };
type JoinState = { id: string; status: string; payment_state: string; product_name: string; location_name: string } | null;

export function ClubJoiningForm({ organisationId, products, locations = [], accountEmail = "", initialState = null }: { organisationId: string; products: Product[]; locations?: Location[]; accountEmail?: string; initialState?: JoinState }) {
  const [message, setMessage] = useState<JoiningActionResult>();
  const [retryMessage, setRetryMessage] = useState<string>();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [key] = useState(() => crypto.randomUUID());
  const selectedProduct = products.find(product => product.id === productId);
  const active = (message?.ok && message.status === "active") || initialState?.status === "active";
  if (active) return <section className={styles.onboarding}><span className="eyebrow">WELCOME TO MADHOUSE</span><h2>Your membership is active</h2><p>{message?.ok ? message.productName : initialState?.product_name}</p><p className={styles.hint}>Your membership and access eligibility now follow Madhouse membership and induction policy.</p><Link className="primary" href="/member-hub">Open R12</Link><details><summary>Install R12</summary><p className="muted">Use your browser menu and choose “Add to Home Screen” or “Install app”. You can continue in this browser if you prefer.</p></details><p className="muted">Native App Store and Play Store links will appear here when available.</p></section>;
  if (message?.ok || initialState) {
    const state = message?.ok ? { id: message.requestId, status: message.status, payment_state: message.paymentState, product_name: message.productName, location_name: "Selected venue" } : initialState!;
    return <section className={styles.onboarding}><span className="eyebrow">JOINING SAVED</span><h2>Continue your Madhouse membership</h2><p>{state.product_name} · {state.location_name}</p><p className={styles.hint}>{state.status === "staff_review" ? "Madhouse staff need to confirm the manual payment arrangement before activation." : "Online payment setup is not available yet. Opening this step has not activated membership or gym access."}</p><p className="muted">Status: {state.status.replaceAll("_", " ")} · Payment: {state.payment_state.replaceAll("_", " ")}</p>{["payment_required", "payment_failed", "retry_required"].includes(state.status) ? <button className="primary" type="button" disabled={pending} onClick={() => startTransition(async () => { const result = await retryJoinPaymentAction(state.id); setRetryMessage(result.error); })}>Fix payment</button> : null}{retryMessage ? <p role="status" className="muted">{retryMessage}</p> : null}<Link className="secondary" href="/member-hub">Open Member Area</Link></section>;
  }
  return <section className={styles.onboarding}><div className={styles.onboardingHead}><div><span className="eyebrow">JOIN MADHOUSE</span><h2>Your membership details</h2><p className="muted">Your progress is saved to your account so you can safely return later.</p></div></div><form className={styles.onboardingForm} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => setMessage(await startClubJoiningAction({
    organisationId, productId: String(form.get("productId")), locationId: String(form.get("locationId")), firstName: String(form.get("firstName")), lastName: String(form.get("lastName")), email: String(form.get("email")), phone: String(form.get("phone")), dateOfBirth: String(form.get("dateOfBirth")), addressLine1: String(form.get("addressLine1")), addressLine2: String(form.get("addressLine2")), townCity: String(form.get("townCity")), postcode: String(form.get("postcode")), emergencyName: String(form.get("emergencyName")), emergencyPhone: String(form.get("emergencyPhone")), termsAccepted: form.get("termsAccepted") === "on", privacyAccepted: form.get("privacyAccepted") === "on", marketingConsent: form.get("marketingConsent") === "on", paymentMethod: String(form.get("paymentMethod")) as "card" | "direct_debit" | "staff_manual", idempotencyKey: key,
  }))); }}>
    <label>Venue<select name="locationId" required defaultValue={locations[0]?.id}>{locations.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>
    <label>Membership<select name="productId" required value={productId} onChange={event => setProductId(event.target.value)}>{products.map(product => <option value={product.id} key={product.id}>{product.name} · £{(product.priceMinor / 100).toFixed(2)} · {product.billing}</option>)}</select></label>
    <div className="form-grid"><label>First name<input name="firstName" autoComplete="given-name" required /></label><label>Last name<input name="lastName" autoComplete="family-name" required /></label></div>
    <label>Email<input name="email" type="email" autoComplete="email" defaultValue={accountEmail} readOnly={Boolean(accountEmail)} required /></label>
    <label>Mobile<input name="phone" type="tel" autoComplete="tel" required /></label><label>Date of birth<input name="dateOfBirth" type="date" required /></label>
    <label>Address<input name="addressLine1" autoComplete="address-line1" required /></label><label>Address line 2 <span className="muted">(optional)</span><input name="addressLine2" autoComplete="address-line2" /></label>
    <div className="form-grid"><label>Town or city<input name="townCity" autoComplete="address-level2" /></label><label>Postcode<input name="postcode" autoComplete="postal-code" required /></label></div>
    <div className="form-grid"><label>Emergency contact<input name="emergencyName" required /></label><label>Emergency contact mobile<input name="emergencyPhone" type="tel" required /></label></div>
    {selectedProduct?.priceMinor === 0 ? <><input type="hidden" name="paymentMethod" value="staff_manual" /><p className="muted">No payment is required for this membership.</p></> : <label>Payment route<select name="paymentMethod" required><option value="card">Card payment</option><option value="direct_debit">Direct Debit</option><option value="staff_manual">Pay or arrange with Madhouse staff</option></select></label>}
    <label><input name="termsAccepted" type="checkbox" required />I accept the membership terms</label><label><input name="privacyAccepted" type="checkbox" required />I have read the privacy notice</label><label><input name="marketingConsent" type="checkbox" />Send me optional Madhouse news and offers</label>
    <button className="primary" disabled={pending || !products.length || !locations.length}>{pending ? "Saving…" : "Continue to payment"}</button>{message && !message.ok ? <p role="alert" className="error-text">{message.error}{message.existingMember ? <> <Link href="/member-hub/link">Activate existing membership</Link></> : null}</p> : null}
  </form></section>;
}
