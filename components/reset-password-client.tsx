"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthBrand } from "@/components/auth-brand";
import { authAccountHref, authApps, type AuthApp } from "@/lib/auth-app";
import { browserSupabase } from "@/lib/supabase-browser";

export function ResetPasswordClient({ app, next }: { app: AuthApp; next: string }) {
  const [status, setStatus] = useState<"checking"|"ready"|"invalid">("checking"); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false); const [updated, setUpdated] = useState(false);
  useEffect(() => {
    const supabase = browserSupabase();
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const code = params.get("code");
    let active = true;
    const invalidate = () => {
      void Promise.resolve().then(() => { if (active) setStatus("invalid"); });
    };
    const validateRecoverySession = async () => {
      const { data, error } = await supabase.auth.getUser();
      if (active) setStatus(!error && data.user ? "ready" : "invalid");
    };
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") void validateRecoverySession();
    });
    if (hash.get("error")) invalidate();
    else if (code) void supabase.auth.exchangeCodeForSession(code).then(({ error }) => error ? invalidate() : validateRecoverySession());
    else if (hash.get("type") === "recovery" || hash.has("access_token")) void supabase.auth.getSession().then(({ data, error }) => error || !data.session ? invalidate() : validateRecoverySession());
    else invalidate();
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);
  const submit = async () => { if (password.length < 8 || password !== confirm) { setMessage(password.length < 8 ? "Use at least 8 characters." : "Passwords do not match."); return; } setSaving(true); const { error } = await browserSupabase().auth.updateUser({ password }); setSaving(false); setMessage(error ? "This reset link is invalid or has expired. Request a new one to continue." : "Password updated securely."); setUpdated(!error); };
  return <main className={`legal-page account-page auth-product-page auth-product-page-${app}`}><AuthBrand app={app} /><header><div><p className="eyebrow">{authApps[app].eyebrow}</p><h1>Set a new password</h1></div></header>{status === "checking" ? <p role="status">Checking your secure reset link…</p> : status === "invalid" ? <p>This reset link is invalid or has expired. Request a new one to continue.</p> : updated ? <Link className="primary" href={next}>Continue to {authApps[app].name}</Link> : <><label>New password<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label><label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} /></label><button className="primary" disabled={saving} onClick={() => void submit()}>{saving ? "Updating…" : "Update password"}</button></>}{message && <p role="status">{message}</p>}<p><Link href={authAccountHref(app, "signIn", next)}>Back to {authApps[app].name} sign in</Link></p></main>;
}
