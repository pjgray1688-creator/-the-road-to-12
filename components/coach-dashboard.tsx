"use client";

import * as React from "react";

type Client = {
  clientUserId: string;
  organisationId: string | null;
  assignmentId: string;
  relationshipId?: string;
  name: string;
  relationship: "primary" | "cover";
  programmeName: string;
  programmeOwnerName: string;
  contextName?: string;
};

type Pending = {
  id: string;
  name: string;
  email?: string | null;
  relationship: "primary" | "cover";
  status: "pending";
  createdAt?: string;
  contextName?: string;
};

type Filter = "active" | "primary" | "cover" | "pending";

function dateLabel(value?: string) {
  if (!value) return "Date not recorded";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function CoachDashboard({ clients, pending, onSelectClient, onPendingAction }: { clients: Client[]; pending: Pending[]; onSelectClient: (client: Client) => void; onPendingAction: (item: Pending, action: "cancel" | "copy" | "resend") => void }) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("active");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleClients = clients.filter(client => {
    const matchesQuery = !normalizedQuery || client.name.toLocaleLowerCase().includes(normalizedQuery) || (client.programmeName ?? "").toLocaleLowerCase().includes(normalizedQuery) || client.contextName?.toLocaleLowerCase().includes(normalizedQuery);
    const matchesFilter = filter === "active" || filter === client.relationship;
    return matchesQuery && matchesFilter;
  });
  const primaryCount = clients.filter(client => client.relationship === "primary").length;
  const coverCount = clients.filter(client => client.relationship === "cover").length;

  return <section className="coach-dashboard" aria-labelledby="coach-dashboard-title">
    <div className="coach-dashboard-grid">
      <article className="coach-dashboard-card coach-dashboard-summary"><span className="eyebrow">CLIENTS</span><strong>{clients.length}</strong><p>Active authorised clients</p><div className="coach-dashboard-meta"><span>{primaryCount} Primary</span><span>{coverCount} Cover</span></div></article>
      <article className="coach-dashboard-card"><span className="eyebrow">NEEDS ATTENTION</span><strong>{pending.length}</strong><p>{pending.length ? "Pending connections need a next step." : "No pending client work right now."}</p><span className="coach-dashboard-status">{pending.length ? "Awaiting acceptance" : "Up to date"}</span></article>
      <article className="coach-dashboard-card"><span className="eyebrow">RECENT ACTIVITY</span><strong>—</strong><p>Open a client to review authorised workouts, sessions and check-ins.</p><span className="coach-dashboard-status">Ready when you are</span></article>
    </div>

    <section className="coach-dashboard-section" aria-labelledby="coach-dashboard-title">
      <div className="coach-dashboard-heading"><div><span className="eyebrow">CLIENT ROSTER</span><h2 id="coach-dashboard-title">Your clients</h2></div><span className="muted">{visibleClients.length} shown</span></div>
      <div className="coach-roster-controls"><label className="coach-roster-search"> <span className="sr-only">Search authorised clients</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your clients" type="search" /></label><div className="coach-roster-filters" aria-label="Filter clients">{(["active", "primary", "cover", "pending"] as Filter[]).map(value => <button type="button" key={value} className={filter === value ? "coach-roster-filter selected" : "coach-roster-filter"} onClick={() => setFilter(value)}>{value === "active" ? "Active" : value === "primary" ? "Primary" : value === "cover" ? "Cover" : `Pending${pending.length ? ` (${pending.length})` : ""}`}</button>)}</div></div>

      {filter === "pending" ? <div className="coach-roster-list">{pending.length ? pending.map(item => <article className="coach-roster-row pending" key={item.id}><div><strong>{item.name}</strong><small>{item.relationship === "cover" ? "Cover PT" : "Primary PT"} · {item.contextName ?? (item.email ? "Private client" : "Madhouse member")} · Awaiting acceptance{item.createdAt ? ` · ${dateLabel(item.createdAt)}` : ""}</small></div><div className="coach-roster-actions"><button type="button" className="text-button" onClick={() => onPendingAction(item, "copy")}>Copy link</button>{item.email ? <button type="button" className="text-button" onClick={() => onPendingAction(item, "resend")}>Resend</button> : null}<button type="button" className="text-button" onClick={() => onPendingAction(item, "cancel")}>Cancel</button></div></article>) : <div className="coach-empty-panel"><h3>No pending connections</h3><p className="muted">New requests and invitations will appear here.</p></div>}</div> : <div className="coach-roster-list">{visibleClients.length ? visibleClients.map(client => <button type="button" className="coach-roster-row" key={`${client.organisationId ?? "direct"}:${client.assignmentId}`} onClick={() => onSelectClient(client)}><div><strong>{client.name}</strong><small>{client.relationship === "cover" ? "Cover PT" : "Primary PT"} · {client.contextName ?? "Private client"}</small></div><div className="coach-roster-detail"><span>{client.programmeName || "Programme status unavailable"}</span><span>Open workspace →</span></div></button>) : <div className="coach-empty-panel"><h3>{query ? "No matching clients" : "No active clients yet"}</h3><p className="muted">{query ? "Try another name or clear the search." : "Add a client to start building your roster."}</p></div>}</div>}
    </section>
  </section>;
}
