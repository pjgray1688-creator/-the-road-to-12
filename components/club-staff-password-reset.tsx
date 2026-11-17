"use client";

import { useState, useTransition } from "react";
import { sendStaffPasswordReset } from "@/app/club/staff/actions";

export function ClubStaffPasswordReset({ organisationId, targetUserId, name }: { organisationId: string; targetUserId: string; name: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  const send = () => {
    if (!window.confirm(`Send a secure password reset link to ${name}'s verified account email?`)) return;
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
    <button className="secondary" type="button" onClick={send} disabled={pending}>{pending ? "Sending…" : "Send Password Reset"}</button>
    {message ? <p role="status" className="muted">{message}</p> : null}
  </div>;
}
