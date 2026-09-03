"use client";
import { useMemo, useState } from "react";
import type { ClubMemberSummaryRead } from "@/lib/club-operational";
import { Surface } from "@/components/ui";
import styles from "./club-members-directory.module.css";

const accessLabel = (state: ClubMemberSummaryRead["accessState"]) => state === "active" ? "Access active" : state === "needs_attention" ? "Needs attention" : "Access unavailable";
const membershipLabel = (status?: string) => status ? status.replace(/_/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()) : "No membership";

export function ClubMembersDirectory({ members, organisationId }: { members: ClubMemberSummaryRead[]; organisationId: string }) {
  const [query, setQuery] = useState("");
  const [accessFilter, setAccessFilter] = useState("all");
  const [membershipFilter, setMembershipFilter] = useState("all");
  const visible = useMemo(() => members.filter(member => {
    const haystack = `${member.displayName} ${member.email ?? ""}`.toLowerCase();
    const membershipState = member.membershipStatus ?? "none";
    return (!query || haystack.includes(query.trim().toLowerCase())) && (accessFilter === "all" || member.accessState === accessFilter) && (membershipFilter === "all" || (membershipFilter === "none" ? !member.membershipStatus : membershipState === membershipFilter));
  }), [members, query, accessFilter, membershipFilter]);
  const statuses = [...new Set(members.map(member => member.membershipStatus).filter(Boolean))] as string[];
  return <Surface><div className={styles.toolbar}><label><span className="sr-only">Search members</span><input aria-label="Search members" placeholder="Search by name or email" value={query} onChange={event => setQuery(event.target.value)} /></label><label><span className="sr-only">Filter access</span><select aria-label="Filter access" value={accessFilter} onChange={event => setAccessFilter(event.target.value)}><option value="all">All access</option><option value="active">Access active</option><option value="needs_attention">Needs attention</option><option value="unavailable">Access unavailable</option></select></label><label><span className="sr-only">Filter membership</span><select aria-label="Filter membership" value={membershipFilter} onChange={event => setMembershipFilter(event.target.value)}><option value="all">All memberships</option><option value="none">No membership</option>{statuses.map(status => <option value={status} key={status}>{membershipLabel(status)}</option>)}</select></label></div><p className={`muted ${styles.count}`}>{visible.length} of {members.length} members</p>{visible.length ? <div className={styles.list}>{visible.map(member => <a className={styles.row} key={member.id} href={`/club/members/${encodeURIComponent(member.userId)}?org=${encodeURIComponent(organisationId)}`}><span className={styles.avatar} aria-hidden="true">{member.displayName.trim().slice(0, 1).toUpperCase()}</span><span className={styles.main}><strong>{member.displayName}</strong><small>{member.email ?? "Member profile"}</small></span><span className={styles.meta}><small>{member.membershipName ?? "No current membership"}{member.homeLocation ? ` · Home: ${member.homeLocation.name}` : ""}</small><em data-state={member.accessState}>{accessLabel(member.accessState)}</em></span><b aria-hidden="true">›</b></a>)}</div> : <p className="muted">{query || accessFilter !== "all" || membershipFilter !== "all" ? "No members match these filters." : "No members yet. Active members will appear here."}</p>}</Surface>;
}
