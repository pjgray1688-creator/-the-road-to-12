"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthBrand } from "@/components/auth-brand";
import { browserSupabase } from "@/lib/supabase-browser";
import { authAccountHref, authApps, nativeContinuationUrl, type AuthApp } from "@/lib/auth-app";

export function AuthCallbackClient({ app, next }: { app: AuthApp; next: string }) {
  const [message, setMessage] = useState("Verifying your email securely…");
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const supabase = browserSupabase();
    let finished = false;
    let validating = false;
    const finish = async () => {
      if (finished || validating) return;
      validating = true;
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user?.email_confirmed_at) {
        validating = false;
        setMessage("This verification link is invalid or has expired. Request a fresh email or sign in if you already verified.");
        return;
      }
      finished = true;
      try { window.sessionStorage.removeItem("r12.pending-auth-email"); } catch {}
      setVerified(true);
      setMessage(`Your email is verified. Continue to ${authApps[app].name}.`);
      window.setTimeout(() => window.location.replace(next), 900);
    };
    const code = params.get("code");
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!code && !hash.get("error") && (event === "SIGNED_IN" || event === "USER_UPDATED") && session?.user) void finish();
    });
    const exchange = code ? supabase.auth.exchangeCodeForSession(code) : supabase.auth.getSession();
    void exchange.then(({ data, error }) => {
      const session = "session" in data ? data.session : null;
      if (session?.user && !error && !hash.get("error")) void finish();
      else {
        setMessage(error || hash.get("error") ? "This verification link is invalid or has expired. Request a fresh email or sign in if you already verified." : "Your email may already be verified. Return to the app and sign in to continue.");
      }
    });
    return () => listener.subscription.unsubscribe();
  }, [app, next]);

  return <main className={`legal-page account-page auth-page verification-page auth-product-page auth-product-page-${app}`}><AuthBrand app={app} /><p className="eyebrow">{authApps[app].eyebrow}</p><h1>{verified ? "Email verified" : "One moment"}</h1><p className="verification-copy" role="status">{message}</p>{verified ? <><Link className="primary" href={next}>Continue on the web</Link><a className="secondary" href={nativeContinuationUrl(app)}>Open {authApps[app].name}</a></> : <Link className="verification-back" href={authAccountHref(app, "signIn", next)}>Continue to sign in</Link>}</main>;
}
