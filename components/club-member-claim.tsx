"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimExistingMemberAction } from "@/app/club/join/actions";

export function ClubMemberClaim({ organisationId, claim }: { organisationId: string; claim: { state: string; customer_id?: string; display_name?: string; email?: string; memberships?: Array<{ id: string; name: string; status: string }> } }) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [error, setError] = useState<string>();
  if (claim.state !== "ready" || !claim.customer_id) return <div><strong>Staff verification needed</strong><p className="muted">We couldn’t safely match one unique member record to your verified email. Madhouse staff can verify your identity and link your account without changing your membership.</p><p className="muted">Reason: {claim.state === "ambiguous" ? "More than one record uses this email." : claim.state === "email_verification_required" ? "Your account email still needs verification." : "No unique email match was found."}</p></div>;
  return <div><strong>Confirm your Madhouse membership</strong><p>{claim.display_name} · {claim.email}</p>{claim.memberships?.map(membership => <p className="muted" key={membership.id}>{membership.name} · {membership.status}</p>)}<p className="muted">This links your existing record. It does not create or replace a membership or ask you to set up payment again.</p><button className="primary" disabled={pending} onClick={() => startTransition(async () => { const result = await claimExistingMemberAction(organisationId, claim.customer_id!); if (result.ok) router.push("/"); else setError(result.error); })}>{pending ? "Linking…" : "Yes, this is my membership"}</button>{error ? <p role="alert" className="error-text">{error}</p> : null}</div>;
}
