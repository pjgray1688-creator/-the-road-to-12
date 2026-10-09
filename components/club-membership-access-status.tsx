"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMembershipAccessStatusAction } from "@/app/club/members/actions";

export function ClubMembershipAccessStatus({ organisationId, membershipId, status }: { organisationId: string; membershipId: string; status: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const nextStatus = status === "active" ? "paused" : status === "paused" ? "active" : null;

  if (!nextStatus) return null;
  const submit = () => {
    if (reason.trim().length < 3) { setMessage("Add a short reason before continuing."); return; }
    startTransition(async () => {
      const result = await setMembershipAccessStatusAction({ organisationId, membershipId, status: nextStatus, reason });
      setMessage(result.ok ? nextStatus === "paused" ? "Access paused. Recurring billing is unchanged." : "Access reactivated." : result.error);
      if (result.ok) { setReason(""); router.refresh(); }
    });
  };

  return <div className="membership-access-controls">
    <label>{nextStatus === "paused" ? "Reason for pausing access" : "Reason for reactivating access"}
      <input value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="For example, member requested a temporary pause" />
    </label>
    <button type="button" className={nextStatus === "paused" ? "secondary" : "primary"} onClick={submit} disabled={pending || reason.trim().length < 3}>
      {pending ? "Saving…" : nextStatus === "paused" ? "Pause access" : "Reactivate access"}
    </button>
    {message ? <p role="status" className="muted">{message}</p> : null}
    {status === "paused" ? <p className="muted">Access is paused. Membership dates and recurring billing are unchanged.</p> : null}
  </div>;
}
