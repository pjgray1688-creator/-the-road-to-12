"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { retryJoinPaymentAction, startClubJoiningAction, type JoiningActionResult } from "@/app/club/join/actions";
import styles from "@/components/club-members-directory.module.css";

type Product = { id: string; name: string; priceMinor: number; joiningFeeMinor: number; joiningFeeConfigured: boolean; checkoutKind: string; billing: string; durationDays?: number };
type Location = { id: string; name: string };
type JoinState = { id: string; status: string; payment_state: string; product_name: string; location_name?: string | null; checkout_kind?: string; joining_fee_minor?: number; first_period_minor?: number; upfront_amount_minor?: number; upfront_payment_state?: string; recurring_authority_state?: string; paid_through_at?: string; activation_blocked_by?: string; gocardless_flow_ready?: boolean } | null;

export function ClubJoiningForm({ organisationId, products, locations = [], accountEmail = "", initialState = null }: { organisationId: string; products: Product[]; locations?: Location[]; accountEmail?: string; initialState?: JoinState }) {
  const router = useRouter();
  const [message, setMessage] = useState<JoiningActionResult>();
  const [retryMessage, setRetryMessage] = useState<string>();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [key] = useState(() => crypto.randomUUID());
  const selectedProduct = products.find(product => product.id === productId);
  const active = (message?.ok && message.status === "active") || initialState?.status === "active";
  if (active) return <section className={styles.onboarding}><span className="eyebrow">WELCOME TO MADHOUSE</span><h2>Your membership is active</h2><p>{message?.ok ? message.productName : initialState?.product_name}</p><p className={styles.hint}>Your membership and access eligibility now follow Madhouse membership and induction policy.</p><Link className="primary" href="/member-hub">Open R12</Link><details><summary>Install R12</summary><p className="muted">Use your browser menu and choose “Add to Home Screen” or “Install app”. You can continue in this browser if you prefer.</p></details><p className="muted">Native App Store and Play Store links will appear here when available.</p></section>;
  if (message?.ok || initialState) {
    const state = message?.ok ? { id: message.requestId, status: message.status, payment_state: message.paymentState, product_name: message.productName, location_name: null, checkout_kind: message.checkoutKind, upfront_amount_minor: message.upfrontAmountMinor, upfront_payment_state: message.paymentState } : initialState!;
    const monthly = (message?.ok ? message.checkoutKind : state.checkout_kind) === "monthly_recurring";
    const providerConfirmed = "confirmed";
    const cardConfirmed = state.upfront_payment_state === providerConfirmed;
    const subscriptionConfirmed = !monthly || state.recurring_authority_state === providerConfirmed;
    const amount = Number(state.upfront_amount_minor ?? 0);
    const recurringAmount = Number(state.first_period_minor ?? (message?.ok ? message.amountMinor : 0));
    const begin = () => startTransition(async () => {
      setRetryMessage(undefined);
      const result = await retryJoinPaymentAction(state.id, "card");
      if (!result.ok) { setRetryMessage(result.error); return; }
      if (result.url) { window.location.assign(result.url); return; }
      setRetryMessage(result.message ?? "Provider confirmation is pending.");
      router.refresh();
    });
    return <section className={styles.onboarding}>
      <span className="eyebrow">JOINING SAVED</span><h2>Continue your Madhouse membership</h2>
      <p>{state.product_name} · Madhouse Membership{state.location_name ? ` · Home gym: ${state.location_name}` : ""}</p>
      <div className={styles.hint}><strong>Due now: £{(amount / 100).toFixed(2)}</strong><p>{monthly ? <>This includes your joining fee and first month. Then £{(recurringAmount / 100).toFixed(2)} is charged monthly through Stripe until cancelled.</> : "This is the full one-off card payment."}</p></div>
      <p><strong>Stripe payment:</strong> {(state.upfront_payment_state ?? state.payment_state).replaceAll("_", " ")}</p>
      {monthly ? <p><strong>Subscription:</strong> {(state.recurring_authority_state ?? "required").replaceAll("_", " ")}</p> : null}
      <p className="muted">Membership activates only after signed Stripe webhooks confirm the payment{monthly ? " and active subscription" : ""}. Returning from Stripe does not activate access by itself. Opening this step has not activated membership or gym access.</p>
      {!cardConfirmed || !subscriptionConfirmed ? <button className="primary" type="button" disabled={pending} onClick={begin}>{pending ? "Opening Stripe…" : state.upfront_payment_state === "failed" || state.recurring_authority_state === "failed" ? "Fix payment — retry Stripe" : "Pay securely with Stripe"}</button> : null}
      {cardConfirmed && subscriptionConfirmed ? <p role="status">Stripe has confirmed your billing. Activating your membership…</p> : null}
      {retryMessage ? <p role="status" className="muted">{retryMessage}</p> : null}
      <Link className="secondary" href="/member-hub">Open Member Area</Link>
    </section>;
  }
  return <section className={styles.onboarding}><div className={styles.onboardingHead}><div><span className="eyebrow">JOIN MADHOUSE</span><h2>Your membership details</h2><p className="muted">Your progress is saved to your account so you can safely return later.</p></div></div><form className={styles.onboardingForm} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => setMessage(await startClubJoiningAction({
    organisationId, productId: String(form.get("productId")), locationId: String(form.get("locationId") || "") || undefined, firstName: String(form.get("firstName")), lastName: String(form.get("lastName")), email: String(form.get("email")), phone: String(form.get("phone")), dateOfBirth: String(form.get("dateOfBirth")), addressLine1: String(form.get("addressLine1")), addressLine2: String(form.get("addressLine2")), townCity: String(form.get("townCity")), postcode: String(form.get("postcode")), emergencyName: String(form.get("emergencyName")), emergencyPhone: String(form.get("emergencyPhone")), termsAccepted: form.get("termsAccepted") === "on", privacyAccepted: form.get("privacyAccepted") === "on", marketingConsent: form.get("marketingConsent") === "on", paymentMethod: String(form.get("paymentMethod")) as "card" | "direct_debit" | "card_and_direct_debit" | "staff_manual", idempotencyKey: key,
  }))); }}>
    <label>Home gym <span className="muted">(optional)</span><select name="locationId" defaultValue=""><option value="">No preference</option>{locations.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>
    <p className={styles.hint}>Every Madhouse membership includes Rotherham and Carlton. Home gym only sets your default shop, reporting and communications preference.</p>
    <label>Madhouse membership plan<select name="productId" required value={productId} onChange={event => setProductId(event.target.value)}>{products.map(product => <option value={product.id} key={product.id}>{product.name} · £{(product.priceMinor / 100).toFixed(2)} · {product.billing}</option>)}</select></label>
    <div className="form-grid"><label>First name<input name="firstName" autoComplete="given-name" required /></label><label>Last name<input name="lastName" autoComplete="family-name" required /></label></div>
    <label>Email<input name="email" type="email" autoComplete="email" defaultValue={accountEmail} readOnly={Boolean(accountEmail)} required /></label>
    <label>Mobile<input name="phone" type="tel" autoComplete="tel" required /></label><label>Date of birth<input name="dateOfBirth" type="date" required /></label>
    <label>Address<input name="addressLine1" autoComplete="address-line1" required /></label><label>Address line 2 <span className="muted">(optional)</span><input name="addressLine2" autoComplete="address-line2" /></label>
    <div className="form-grid"><label>Town or city<input name="townCity" autoComplete="address-level2" /></label><label>Postcode<input name="postcode" autoComplete="postal-code" required /></label></div>
    <div className="form-grid"><label>Emergency contact<input name="emergencyName" required /></label><label>Emergency contact mobile<input name="emergencyPhone" type="tel" required /></label></div>
    {!selectedProduct ? <p className="muted">No membership is currently available.</p> : selectedProduct.priceMinor === 0 ? <><input type="hidden" name="paymentMethod" value="card" /><p className="muted">No payment is required for this membership.</p></> : selectedProduct.checkoutKind === "monthly_recurring" ? <><input type="hidden" name="paymentMethod" value="card" /><div className={styles.hint}><strong>Stripe monthly membership</strong><p>{selectedProduct.joiningFeeConfigured ? <>Due now: £{((selectedProduct.priceMinor + selectedProduct.joiningFeeMinor) / 100).toFixed(2)} — £{(selectedProduct.joiningFeeMinor / 100).toFixed(2)} joining fee plus £{(selectedProduct.priceMinor / 100).toFixed(2)} for your first month. Ongoing: £{(selectedProduct.priceMinor / 100).toFixed(2)} monthly through Stripe until cancelled.</> : <>This membership is temporarily unavailable while Madhouse configures its joining fee.</>}</p></div></> : selectedProduct.checkoutKind === "annual_one_off" ? <><input type="hidden" name="paymentMethod" value="card" /><div className={styles.hint}><strong>Stripe annual membership</strong><p>{selectedProduct.joiningFeeConfigured ? <>Due now: £{((selectedProduct.priceMinor + selectedProduct.joiningFeeMinor) / 100).toFixed(2)} — £{(selectedProduct.joiningFeeMinor / 100).toFixed(2)} joining fee plus £{(selectedProduct.priceMinor / 100).toFixed(2)} for the annual membership. Access includes both Madhouse gyms until the annual paid-through date; this plan does not renew automatically.</> : <>This annual membership is unavailable until Madhouse configures its joining fee.</>}</p></div></> : <><input type="hidden" name="paymentMethod" value="card" /><div className={styles.hint}><strong>One-off card payment</strong><p>Pay £{(selectedProduct.priceMinor / 100).toFixed(2)} once. {selectedProduct.checkoutKind === "day_pass" ? "Access lasts for the purchased day." : selectedProduct.checkoutKind === "week_pass" ? "Access lasts for seven days." : "Access follows the configured paid period."}</p></div></>}
    <label><input name="termsAccepted" type="checkbox" required />I accept the membership terms</label><label><input name="privacyAccepted" type="checkbox" required />I have read the privacy notice</label><label><input name="marketingConsent" type="checkbox" />Send me optional Madhouse news and offers</label>
    <button className="primary" disabled={pending || !products.length || ((selectedProduct?.checkoutKind === "monthly_recurring" || selectedProduct?.checkoutKind === "annual_one_off") && !selectedProduct.joiningFeeConfigured)}>{pending ? "Saving…" : "Continue to payment"}</button>{message && !message.ok ? <p role="alert" className="error-text">{message.error}{message.existingMember ? <> <Link href="/member-hub/link">Activate existing membership</Link></> : null}</p> : null}
  </form></section>;
}
