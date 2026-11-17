"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeRequiredPasswordChange } from "@/app/account/required-password-change/actions";
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from "@/lib/auth-password-policy";
import { browserSupabase } from "@/lib/supabase-browser";

export function RequiredPasswordChangeForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [complete, setComplete] = useState(false);
  const valid = password.length >= AUTH_PASSWORD_MIN_LENGTH && password.length <= AUTH_PASSWORD_MAX_LENGTH && password === confirmation;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || complete) return;
    startTransition(async () => {
      setMessage("");
      const result = await completeRequiredPasswordChange({ password, confirmation });
      setPassword("");
      setConfirmation("");
      if (result.ok) {
        setComplete(true);
        setMessage("Password updated. Sign in again using your new password.");
      } else if (result.code === "invalid_length") setMessage(`Use a password between ${AUTH_PASSWORD_MIN_LENGTH} and ${AUTH_PASSWORD_MAX_LENGTH} characters.`);
      else if (result.code === "mismatch") setMessage("The passwords do not match.");
      else setMessage("The password could not be updated. Sign in again or request a new password reset.");
    });
  }

  return <form onSubmit={submit} autoComplete="off">
    <label>New password<input type="password" autoComplete="new-password" minLength={AUTH_PASSWORD_MIN_LENGTH} maxLength={AUTH_PASSWORD_MAX_LENGTH} required value={password} onChange={event => setPassword(event.target.value)} /></label>
    <label>Confirm new password<input type="password" autoComplete="new-password" minLength={AUTH_PASSWORD_MIN_LENGTH} maxLength={AUTH_PASSWORD_MAX_LENGTH} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
    <p className="muted">Use at least {AUTH_PASSWORD_MIN_LENGTH} characters. Supabase Auth also enforces the configured password policy.</p>
    <button className="primary" type="submit" disabled={!valid || pending || complete}>{pending ? "Updating password…" : complete ? "Password updated" : "Update password"}</button>
    {complete ? <button className="secondary" type="button" onClick={() => void browserSupabase().auth.signOut({ scope: "local" }).finally(() => router.replace("/account?mode=signIn"))}>Continue to sign in</button> : null}
    {message ? <p role="status" aria-live="polite">{message}</p> : null}
  </form>;
}
