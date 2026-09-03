"use client";
import { useState, useTransition } from "react";
import { linkClubCustomerAction } from "@/app/club/members/actions";
import type { ClubMemberSummaryRead } from "@/lib/club-operational";

export function ClubCustomerLink({ organisationId, customerId, members }: { organisationId: string; customerId: string; members: ClubMemberSummaryRead[] }) {
  const [userId, setUserId] = useState("");
  const [message, setMessage] = useState<string>();
  const [pending, startTransition] = useTransition();
  const eligible = members.filter(member => member.active && member.role !== "guest");
  return <div style={{ display: "grid", gap: 10, marginTop: 14 }}><label style={{ display: "grid", gap: 6, fontSize: 12 }}>Link existing R12 account<select aria-label="Choose R12 account" value={userId} onChange={event => setUserId(event.target.value)}><option value="">Choose an active organisation account</option>{eligible.map(member => <option key={member.userId} value={member.userId}>{member.displayName}{member.email ? ` · ${member.email}` : ""}</option>)}</select></label><button type="button" className="secondary" disabled={!userId || pending} onClick={() => startTransition(async () => { const result = await linkClubCustomerAction({ organisationId, customerId, userId }); setMessage(result.ok ? "R12 account linked. Refreshing the profile…" : result.error); if (result.ok) window.location.reload(); })}>{pending ? "Linking…" : "Link R12 account"}</button>{message ? <p className="muted" role="status">{message}</p> : null}</div>;
}
