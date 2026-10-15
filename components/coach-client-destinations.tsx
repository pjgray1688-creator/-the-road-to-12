import Link from "next/link";
import styles from "./coach-client-destinations.module.css";

type CoachClient = { clientUserId: string; name: string; relationship: "primary" | "cover"; programmeName: string; contextName?: string };

export function CoachClientDestinations({ clients, destination }: { clients: CoachClient[]; destination: "programme" | "nutrition" }) {
  const title = destination === "programme" ? "Choose a client programme" : "Choose a client nutrition plan";
  const description = destination === "programme" ? "Open an authorised client workspace to review or manage their training plan." : "Open an authorised client workspace to review or manage their nutrition plan.";
  return <main className={`module-page ${styles.page}`}><header className={styles.heading}><span className="eyebrow">R12 COACH</span><h1>{title}</h1><p>{description}</p></header>
    {clients.length ? <div className={styles.list}>{clients.map(client => <Link className={styles.card} key={client.clientUserId} href={destination === "programme" ? `/coach?client=${encodeURIComponent(client.clientUserId)}&section=programme` : `/coach/nutrition?client=${encodeURIComponent(client.clientUserId)}`}><span><strong>{client.name}</strong><small>{client.relationship === "cover" ? "Cover PT" : "Primary PT"}{client.contextName ? ` · ${client.contextName}` : ""}</small></span><span><strong>{client.programmeName}</strong><small>Open {destination === "programme" ? "programme" : "nutrition"} →</small></span></Link>)}</div> : <section className={`card ${styles.empty}`}><h2>No active clients yet</h2><p>Connect a client from your Coach workspace to see their plans here.</p><Link className="primary" href="/coach">Open clients</Link></section>}
  </main>;
}
