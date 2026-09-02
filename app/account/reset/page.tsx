"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { browserSupabase } from "@/lib/supabase-browser";

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => { const supabase = browserSupabase(); const { data: listener } = supabase.auth.onAuthStateChange(event => { if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true); }); void supabase.auth.getSession().then(({ data }) => setReady(Boolean(data.session))); return () => listener.subscription.unsubscribe(); }, []);
  const submit = async () => { if (password.length < 8 || password !== confirm) { setMessage(password.length < 8 ? "Use at least 8 characters." : "Passwords do not match."); return; } setSaving(true); const { error } = await browserSupabase().auth.updateUser({ password }); setSaving(false); setMessage(error ? "This reset link is invalid or has expired. Request a new one to continue." : "Password updated. You can now sign in."); };
  return <main className="legal-page account-page"><header><span className="brand-mark">R12</span><div><p className="eyebrow">R12</p><h1>Set a new password</h1></div></header>{!ready ? <p>This reset link is invalid or has expired. Request a new one to continue.</p> : <><label>New password<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label><label>Confirm password<input type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} /></label><button className="primary" disabled={saving} onClick={() => void submit()}>{saving ? "Updating…" : "Update password"}</button></>}{message && <p role="status">{message}</p>}<p><Link href="/account">Back to sign in</Link></p></main>;
}
