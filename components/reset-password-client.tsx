"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AuthBrand } from "@/components/auth-brand";
import { authAccountHref, authApps, type AuthApp } from "@/lib/auth-app";
import { authReturnUrlWithoutCredentials, exchangePasswordRecoverySession, passwordRecoveryLink, verifyPasswordRecoveryToken } from "@/lib/auth-url-session";
import { authRedirectSupabase } from "@/lib/supabase-browser";

export function ResetPasswordClient({ app, next }: { app: AuthApp; next: string }) {
  const [status, setStatus] = useState<"checking"|"continue"|"verifying"|"ready"|"invalid">("checking"); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false); const [updated, setUpdated] = useState(false);
  const clientRef = useRef<ReturnType<typeof authRedirectSupabase> | null>(null);
  const recoveryAttemptRef = useRef<Promise<{ ok: boolean }> | null>(null);
  const tokenRef = useRef<{ tokenHash: string; type: string | null } | null>(null);
  useEffect(() => {
    const href = window.location.href;
    const link = passwordRecoveryLink(href);
    window.history.replaceState(window.history.state, "", authReturnUrlWithoutCredentials(href));
    if (link.kind === "token") {
      if (link.type === "recovery") tokenRef.current = link;
      let active = true;
      void Promise.resolve().then(() => { if (active) setStatus(link.type === "recovery" ? "continue" : "invalid"); });
      return () => { active = false; };
    }
    if (link.kind !== "pkce") {
      let active = true;
      void Promise.resolve().then(() => { if (active) setStatus("invalid"); });
      return () => { active = false; };
    }
    const supabase = clientRef.current ?? authRedirectSupabase(); clientRef.current = supabase;
    recoveryAttemptRef.current ??= exchangePasswordRecoverySession(supabase, href);
    let active = true;
    void recoveryAttemptRef.current.then(result => {
      if (active) setStatus(result.ok ? "ready" : "invalid");
    });
    return () => { active = false; };
  }, []);
  const continueWithToken = async () => {
    if (status !== "continue" || !tokenRef.current || recoveryAttemptRef.current) return;
    setStatus("verifying");
    const supabase = clientRef.current ?? authRedirectSupabase(); clientRef.current = supabase;
    const token = tokenRef.current; tokenRef.current = null;
    const attempt = verifyPasswordRecoveryToken(supabase, token.tokenHash, token.type);
    recoveryAttemptRef.current = attempt;
    const result = await attempt;
    setStatus(result.ok ? "ready" : "invalid");
  };
  const submit = async () => { const supabase = clientRef.current; if (status !== "ready" || !supabase) { setStatus("invalid"); return; } if (password.length < 8 || password !== confirm) { setMessage(password.length < 8 ? "Use at least 8 characters." : "Passwords do not match."); return; } setSaving(true); const { error } = await supabase.auth.updateUser({ password }); setSaving(false); setMessage(error ? "This reset link is invalid or has expired. Request a new one to continue." : "Password updated securely."); setUpdated(!error); };
  return <main className={`legal-page account-page auth-product-page auth-product-page-${app}`}><AuthBrand app={app} /><header><div><p className="eyebrow">{authApps[app].eyebrow}</p><h1>Set a new password</h1></div></header>{status === "checking" || status === "verifying" ? <p role="status">{status === "checking" ? "Checking your secure reset link…" : "Verifying your reset request…"}</p> : status === "continue" ? <><p>Your password has not been changed yet. Continue when you are ready.</p><button className="primary" type="button" onClick={() => void continueWithToken()}>Continue to reset password</button></> : status === "invalid" ? <p>This reset link is invalid or has expired. Request a new one to continue.</p> : updated ? <Link className="primary" href={next}>Continue to {authApps[app].name}</Link> : <><label>New password<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label><label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} /></label><button className="primary" disabled={saving} onClick={() => void submit()}>{saving ? "Updating…" : "Update password"}</button></>}{message && <p role="status">{message}</p>}<p><Link href={authAccountHref(app, "signIn", next)}>Back to {authApps[app].name} sign in</Link></p></main>;
}
