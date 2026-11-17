"use client";

import { useState, useTransition } from "react";
import { changeStaffPassword, sendStaffPasswordReset } from "@/app/club/staff/password-actions";
import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH } from "@/lib/auth-password-policy";

export function ClubStaffPasswordReset({ organisationId, targetUserId, name }: { organisationId: string; targetUserId: string; name: string }) {
  const [pending, startTransition] = useTransition();
  const [formOpen, setFormOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [requirePasswordChange, setRequirePasswordChange] = useState(true);
  const [message, setMessage] = useState("");

  const savePassword = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirmation || password.length < AUTH_PASSWORD_MIN_LENGTH || password.length > AUTH_PASSWORD_MAX_LENGTH) return;
    if (!window.confirm(`Change ${name}'s password now? Supabase will revoke existing refresh sessions; already-issued access tokens may remain valid until they expire.`)) return;
    startTransition(async () => {
      setMessage("");
      const result = await changeStaffPassword({ organisationId, targetUserId, password, confirmation, requirePasswordChange });
      setPassword("");
      setConfirmation("");
      if (result.ok && result.code === "audit_unavailable") {
        setMessage("Password changed, but the outcome audit could not be confirmed. Notify the system administrator.");
      } else if (result.ok) {
        setMessage("Password changed and existing refresh sessions revoked. Already-issued access tokens remain valid until they expire; the staff member should sign in again with the new password.");
        setFormOpen(false);
      } else if (result.code === "invalid_length") {
        setMessage(`Use a password between ${AUTH_PASSWORD_MIN_LENGTH} and ${AUTH_PASSWORD_MAX_LENGTH} characters.`);
      } else if (result.code === "mismatch") {
        setMessage("The passwords do not match.");
      } else if (result.code === "not_authorized") {
        setMessage("You are not authorised to change this staff account password.");
      } else {
        setMessage("The password could not be changed. Check the password requirements and try again.");
      }
    });
  };

  const sendResetEmail = () => {
    if (!window.confirm(`Send a secure password reset email to ${name}'s verified account email?`)) return;
    startTransition(async () => {
      setMessage("");
      const result = await sendStaffPasswordReset({ organisationId, targetUserId });
      setMessage(result.ok ? "Password reset email sent." : result.code === "no_verified_email"
        ? "No verified sign-in email is available. Verify the staff member’s registered email before requesting a reset."
        : result.code === "not_authorized"
          ? "You are not authorised to reset this staff account."
          : "The reset email could not be sent. Try again shortly.");
    });
  };

  return <div className="club-staff-password-reset">
    <div className="button-row">
      <button className="secondary" type="button" onClick={() => { setFormOpen(value => !value); setMessage(""); }} aria-expanded={formOpen} disabled={pending}>
        {formOpen ? "Cancel password change" : "Change Password"}
      </button>
      <button className="secondary" type="button" onClick={sendResetEmail} disabled={pending}>
        {pending ? "Working…" : "Send Password Reset Email"}
      </button>
    </div>
    {formOpen ? <form onSubmit={savePassword} autoComplete="off">
      <label>New password<input type="password" autoComplete="new-password" minLength={AUTH_PASSWORD_MIN_LENGTH} maxLength={AUTH_PASSWORD_MAX_LENGTH} required value={password} onChange={event => setPassword(event.target.value)} /></label>
      <label>Confirm new password<input type="password" autoComplete="new-password" minLength={AUTH_PASSWORD_MIN_LENGTH} maxLength={AUTH_PASSWORD_MAX_LENGTH} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>
      <p className="muted">Use at least {AUTH_PASSWORD_MIN_LENGTH} characters. Supabase Auth also enforces the project’s configured password policy.</p>
      <label><input type="checkbox" checked={requirePasswordChange} onChange={event => setRequirePasswordChange(event.target.checked)} /> Require the staff member to choose a new password at next sign-in</label>
      <p className="muted">When selected, R12 blocks access to Member, Coach and Club until they change the password. They will need to sign in again afterward.</p>
      <button className="primary" type="submit" disabled={pending || password.length < AUTH_PASSWORD_MIN_LENGTH || password.length > AUTH_PASSWORD_MAX_LENGTH || password !== confirmation}>
        {pending ? "Changing password…" : "Save Password"}
      </button>
    </form> : null}
    {message ? <p role="status" className="muted">{message}</p> : null}
  </div>;
}
