"use client";

import { useState, useTransition } from "react";
import { resendMemberActivationAction } from "@/app/club/members/actions";

export function ClubMemberActivationEmail({ organisationId, customerId }: { organisationId: string; customerId: string }) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  return <div><p className="muted">Queue or resend the account activation email. This does not create an account or change membership access.</p><button type="button" className="secondary" disabled={pending} onClick={() => startTransition(async () => { const result = await resendMemberActivationAction({ organisationId, customerId }); setMessage(result.ok ? "Activation email queued for delivery." : result.error ?? "Activation could not be queued."); })}>{pending ? "Queuing…" : "Queue / resend activation email"}</button>{message ? <p role="status">{message}</p> : null}</div>;
}
