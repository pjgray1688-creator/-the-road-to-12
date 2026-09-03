"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { ClubCustomer } from "@/lib/club-operations";
import type { ClubMemberSummaryRead } from "@/lib/club-operational";
import { ClubMemberOnboarding } from "@/components/club-member-onboarding";
import type { ClubProduct, ClubRole, OrganisationLocation } from "@/lib/club";
import { Surface } from "@/components/ui";
import styles from "./club-reception.module.css";

type CashItem = { id: string; status: string; declaredAmountMinor: number; currency: string; memberDisplayName?: string; locationId?: string };
const money = (minor: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);

export function ClubReception({ organisationId, role, members, customers, products, locations, cashDeclarations, canAssign }: { organisationId: string; role: ClubRole; members: ClubMemberSummaryRead[]; customers: ClubCustomer[]; products: ClubProduct[]; locations: OrganisationLocation[]; cashDeclarations: CashItem[]; canAssign: boolean }) {
  const [query, setQuery] = useState("");
  const people = useMemo(() => {
    const linked = new Set<string>();
    const memberRows = members.map(member => { linked.add(member.userId); return { id: `user:${member.userId}`, href: `/club/members/${encodeURIComponent(member.userId)}?org=${encodeURIComponent(organisationId)}`, name: member.displayName, email: member.email, account: "R12 account linked", membership: member.membershipName ?? "No current membership", access: member.accessState === "active" ? "Access active" : member.accessState === "needs_attention" ? "Access needs attention" : "Access unavailable" }; });
    const customerRows = customers.filter(customer => !customer.userId || !linked.has(customer.userId)).map(customer => ({ id: `customer:${customer.id}`, href: `/club/members/customer/${encodeURIComponent(customer.id)}?org=${encodeURIComponent(organisationId)}`, name: customer.displayName, email: customer.email, account: customer.userId ? "R12 account linked" : "R12 account not linked", membership: "Membership details in profile", access: customer.userId ? "Access available after review" : "Digital access awaits account link" }));
    return [...memberRows, ...customerRows];
  }, [members, customers, organisationId]);
  const visible = people.filter(person => !query.trim() || `${person.name} ${person.email ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pendingCash = cashDeclarations.filter(item => item.status === "declared");
  return <div className={styles.workspace}>
    <Surface className={styles.searchPanel}><div><span className="eyebrow">FIND PERSON</span><h2>Reception search</h2><p className="muted">Find linked members and walk-in customers in this organisation.</p></div><input className={styles.search} aria-label="Find a person" placeholder="Search by name or email" value={query} onChange={event => setQuery(event.target.value)} />{visible.length ? <div className={styles.results}>{visible.slice(0, 12).map(person => <Link className={styles.result} href={person.href} key={person.id}><span className={styles.avatar} aria-hidden="true">{person.name.trim().slice(0, 1).toUpperCase()}</span><main><strong>{person.name}</strong><small>{person.email ?? person.account} · {person.membership}</small></main><span className={styles.status}>{person.access}</span><b aria-hidden="true">›</b></Link>)}</div> : <p className="muted">No people match that search.</p>}</Surface>
    <Surface><span className="eyebrow">COMMON TASKS</span><div className={styles.actions}><Link href={`/club/shop?org=${encodeURIComponent(organisationId)}`}><strong>Shop sale</strong><small>Open the existing reception checkout</small></Link></div></Surface>
    {pendingCash.length ? <Surface><div className={styles.attention}><div><span className="eyebrow">CASH TO REVIEW</span><h2>Awaiting verification</h2><p className="muted">Declared cash is not confirmed payment until staff verify it.</p></div>{pendingCash.slice(0, 5).map(item => <div className={styles.attentionRow} key={item.id}><span>{item.memberDisplayName ?? "Customer declaration"}<small>{item.locationId ? locations.find(location => location.id === item.locationId)?.name ?? "Organisation location" : "Location not recorded"}</small></span><strong>{money(item.declaredAmountMinor, item.currency)}</strong></div>)}<Link href={`/club/shop?org=${encodeURIComponent(organisationId)}#cash-review`}>Review cash declarations</Link></div></Surface> : null}
    <ClubMemberOnboarding organisationId={organisationId} customers={customers} products={products} role={role} canAssign={canAssign} />
  </div>;
}
