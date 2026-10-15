"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "./coach-client-destinations.module.css";

type CoachClient = { clientUserId: string; name: string; relationship: "primary" | "cover"; programmeName: string; contextName?: string };

export function CoachClientDestinations({ clients, destination }: { clients: CoachClient[]; destination: "programme" | "nutrition" }) {
  const [query, setQuery] = useState("");
  const title = destination === "programme" ? "Programmes" : "Nutrition";
  const visibleClients = useMemo(() => {
    const value = query.trim().toLocaleLowerCase();
    return clients.filter(client => !value || client.name.toLocaleLowerCase().includes(value) || client.programmeName.toLocaleLowerCase().includes(value));
  }, [clients, query]);
  const hrefFor = (id: string) => destination === "programme"
    ? `/coach?client=${encodeURIComponent(id)}&section=programme`
    : `/coach/nutrition?client=${encodeURIComponent(id)}`;

  return <main className={`module-page ${styles.page}`}>
    <header className={styles.heading}><span className="eyebrow">CLIENT PLANS</span><h1>{title}</h1></header>
    {clients.length ? <>
      <label className={styles.search}><span className="sr-only">Search linked clients</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a client" /></label>
      <div className={styles.list} aria-label={`${title} clients`}>
        {visibleClients.length ? visibleClients.map(client => <Link className={styles.card} key={client.clientUserId} href={hrefFor(client.clientUserId)}>
          <span><strong>{client.name}</strong><small>{client.relationship === "cover" ? "Cover PT" : "Primary PT"}{client.contextName ? ` · ${client.contextName}` : ""}</small></span>
          <span><small>{destination === "programme" ? client.programmeName || "Training plan" : "Nutrition plan"}</small><strong>Open →</strong></span>
        </Link>) : <p className={styles.empty}>No linked clients match that search.</p>}
      </div>
    </> : <section className={styles.empty}><h2>No linked clients yet</h2><p>Connect a client to work with their {destination === "programme" ? "training programme" : "nutrition plan"}.</p><Link href="/coach" className={styles.quietLink}>Go to Clients</Link></section>}
  </main>;
}
