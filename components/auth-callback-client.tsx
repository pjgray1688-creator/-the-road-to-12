"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AuthBrand } from "@/components/auth-brand";
import { authReturnUrlWithoutCredentials, exchangeAuthCodeSession } from "@/lib/auth-url-session";
import { authRedirectSupabase } from "@/lib/supabase-browser";
import { authAccountHref, authApps, nativeContinuationUrl, type AuthApp } from "@/lib/auth-app";

export function AuthCallbackClient({ app, next }: { app: AuthApp; next: string }) {
  const [message, setMessage] = useState("Verifying your email securely…");
  const [verified, setVerified] = useState(false);
  const clientRef = useRef<ReturnType<typeof authRedirectSupabase> | null>(null);
  const exchangeAttemptRef = useRef<ReturnType<typeof exchangeAuthCodeSession> | null>(null);

  useEffect(() => {
    const href = window.location.href;
    const supabase = clientRef.current ?? authRedirectSupabase();
    clientRef.current = supabase;
    exchangeAttemptRef.current ??= exchangeAuthCodeSession(supabase, href);
    let active = true;
    let redirectTimer: number | undefined;
    void exchangeAttemptRef.current.then(result => {
      window.history.replaceState(window.history.state, "", authReturnUrlWithoutCredentials(href));
      if (!active) return;
      if (!result.ok || result.redirectType === "recovery" || !result.user.email_confirmed_at) {
        setMessage("This verification link is invalid or has expired. Request a fresh email or sign in if you already verified.");
        return;
      }
      try { window.sessionStorage.removeItem("r12.pending-auth-email"); } catch {}
      setVerified(true);
      setMessage(`Your email is verified. Continue to ${authApps[app].name}.`);
      redirectTimer = window.setTimeout(() => window.location.replace(next), 900);
    });
    return () => { active = false; if (redirectTimer) window.clearTimeout(redirectTimer); };
  }, [app, next]);

  return <main className={`legal-page account-page auth-page verification-page auth-product-page auth-product-page-${app}`}><AuthBrand app={app} /><p className="eyebrow">{authApps[app].eyebrow}</p><h1>{verified ? "Email verified" : "One moment"}</h1><p className="verification-copy" role="status">{message}</p>{verified ? <><Link className="primary" href={next}>Continue on the web</Link><a className="secondary" href={nativeContinuationUrl(app)}>Open {authApps[app].name}</a></> : <Link className="verification-back" href={authAccountHref(app, "signIn", next)}>Continue to sign in</Link>}</main>;
}
