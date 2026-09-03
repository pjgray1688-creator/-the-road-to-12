"use client";
import { useTransition } from "react";
import { endMembershipAction } from "@/app/club/members/actions";
export function ClubMembershipEnd({ organisationId, membershipId }: { organisationId: string; membershipId: string }) { const [pending, start] = useTransition(); return <button type="button" className="secondary" disabled={pending} onClick={() => { if (!window.confirm("End this membership now? Access will follow the recorded end date.")) return; start(async () => { await endMembershipAction({ organisationId, membershipId }); }); }}>{pending ? "Ending…" : "End membership"}</button>; }
