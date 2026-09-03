"use client";
import { useMemo, useState } from "react";
import type { ClubMemberSummary } from "@/lib/club-operational";
import { NavigationRow, Surface } from "@/components/ui";

export function ClubMembersDirectory({ members, organisationId }: { members: ClubMemberSummary[]; organisationId: string }) {
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState("all");
  const visible = useMemo(() => members.filter(member => {
    const haystack = `${member.displayName} ${member.email ?? ""}`.toLowerCase();
    return (!query || haystack.includes(query.toLowerCase())) && (filter === "all" || member.accessState === filter);
  }), [members, query, filter]);
  return <Surface><div className="club-directory-toolbar"><input aria-label="Search members" placeholder="Search members" value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="Filter members" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All members</option><option value="active">Access active</option><option value="needs_attention">Needs attention</option><option value="unavailable">Access unavailable</option></select></div>{visible.length ? visible.map(member => <NavigationRow key={member.id} href={`/club/members/${encodeURIComponent(member.userId)}?org=${encodeURIComponent(organisationId)}`} label={member.displayName} detail={[member.email, member.membershipName, member.membershipStatus ? member.membershipStatus.replace("_", " ") : undefined].filter(Boolean).join(" · ") || "No current membership"} />) : <p className="muted">{query ? "No members match that search." : "No members yet."}</p>}</Surface>;
}
