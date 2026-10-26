"use client";

import { useSyncExternalStore, useState } from "react";
import Link from "next/link";
import { AuthBrand } from "@/components/auth-brand";
import { browserSupabase } from "@/lib/supabase-browser";
import { authCallbackUrl } from "@/lib/auth-return";
import { authAccountHref, authApps, type AuthApp } from "@/lib/auth-app";

function maskEmail(value: string) {
  const [name, domain] = value.split("@");
  if (!name || !domain) return "your email address";
  return `${name.length < 3 ? `${name[0] ?? "•"}•` : `${name.slice(0, 2)}•••`}@${domain}`;
}

function subscribePendingEmail(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function pendingEmailSnapshot() {
  try { return window.sessionStorage.getItem("r12.pending-auth-email") ?? ""; } catch { return ""; }
}

export default function VerifyAccountClient({ app, next }: { app: AuthApp; next: string }) {
  const email = useSyncExternalStore(subscribePendingEmail, pendingEmailSnapshot, () => "");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const isStaff = next.startsWith("/club/staff/claim");
  const isMemberLink = next === "/member-hub/link";

  const resend = async () => {
    if (!email) { setMessage("Return to account creation to enter your email and request another verification link."); return; }
    setSending(true); setMessage("");
    const { error } = await browserSupabase().auth.resend({ type: "signup", email, options: { emailRedirectTo: authCallbackUrl(window.location.origin, next, app) } });
    setSending(false);
    setMessage(error ? "We couldn’t resend the verification email just now. Please wait a moment and try again." : `If this address has a pending ${authApps[app].name} verification, a fresh link is on its way.`);
  };

  return <main className={`legal-page account-page auth-page verification-page auth-product-page auth-product-page-${app}`}>
    <AuthBrand app={app} />
    <p className="eyebrow">{authApps[app].eyebrow}</p>
    <h1>Check your email</h1>
    <p className="verification-copy">We’ve sent a verification link to:</p>
    <strong className="verification-email">{email ? maskEmail(email) : "the email address you entered"}</strong>
    <p className="verification-copy">Open the email and verify your address to continue. {isStaff ? "Your Club staff access is waiting; once verified, we’ll bring you straight back to finish activating it." : isMemberLink ? "Once verified, we’ll return you to link your existing membership." : `Once verified, continue in ${authApps[app].name}.`}</p>
    <p className="muted">If it’s not in your inbox, check your junk or spam folder.</p>
    <button className="primary" type="button" disabled={sending} onClick={() => void resend()}>{sending ? "Sending…" : "Resend verification email"}</button>
    {message ? <p role="status" className="verification-status">{message}</p> : null}
    <Link className="verification-back" href={authAccountHref(app, "signUp", next)}>Use a different email</Link>
    <p className="verification-footer">You can close this screen after opening the verification email.</p>
  </main>;
}
