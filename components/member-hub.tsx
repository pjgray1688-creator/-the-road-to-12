import Link from "next/link";

import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import type { ClubMemberOperationalRead } from "@/lib/club-operational";
import type { ClubBalanceAccount, ClubOrder } from "@/lib/club-commerce";
import type { ClubClassSession } from "@/lib/club-operations";
import type { Organisation } from "@/lib/club";

const money = (minor: number | undefined, currency = "GBP") => typeof minor === "number"
  ? new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100)
  : "—";
const date = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export type MemberHubData = {
  organisation: Organisation;
  profile: ClubMemberOperationalRead;
  balance?: ClubBalanceAccount;
  sessions: ClubClassSession[];
  bookings: Array<{ sessionId: string; status: string }>;
  orders: ClubOrder[];
};

export function MemberHub({ data }: { data: MemberHubData[] }) {
  if (!data.length) return <AppShell className="module-page member-hub-page"><PageHeader eyebrow="MEMBER AREA" title="Member Area" description="Your membership and gym services in R12." /><Surface className="member-hub-section"><EmptyState title="Connect your gym">Already a member? Link your membership to R12, or join an onboarded gym to get started.</EmptyState><div className="quick-grid"><Link className="member-hub-link" href="/member-hub/link"><strong>Link existing membership</strong><small>Verify the email held by your gym</small></Link><Link className="member-hub-link" href="/join"><strong>Join a gym</strong><small>Choose an onboarded gym</small></Link></div></Surface></AppShell>;

  return <AppShell className="module-page member-hub-page"><PageHeader eyebrow="MEMBER AREA" title="Member Area" description="Your membership and gym services in R12." />{data.map(item => { const active = item.profile.memberships.find(m => m.status === "active") ?? item.profile.memberships[0]; const upcoming = item.sessions.filter(s => s.status === "scheduled" && new Date(s.startsAt).getTime() >= Date.now()).slice(0, 3); const ownOrders = item.orders.filter(order => order.userId === item.profile.member.userId || (item.profile.customer?.id && order.customerId === item.profile.customer.id)).slice(0, 2); const shopHref = `/member-hub/shop?org=${encodeURIComponent(item.organisation.id)}`; return <div key={item.organisation.id} className="member-hub-tenant"><Surface className="member-hub-section member-tenant-identity"><span className="eyebrow">YOUR GYM</span>{item.organisation.slug?.toLowerCase().includes("madhouse") ? <img className="member-tenant-logo" src="/club-branding/madhouse-club-wide.png" alt="Madhouse Gym" /> : null}<h2>{item.organisation.name}</h2></Surface><Surface className="member-hub-section member-hub-shop-summary" aria-label="Member shop"><div className="section-heading-row"><div><span className="eyebrow">SHOP / BALANCE</span><h2>Shop</h2></div><strong>{money(item.balance?.balanceMinor, item.balance?.currency)}</strong></div><Link className="member-hub-link primary" href={shopHref}><strong>Open member shop</strong><small>Browse products and use your balance</small></Link></Surface><Surface className="member-hub-section"><span className="eyebrow">MEMBERSHIP & ACCESS</span><div className="club-detail-row"><span>Membership</span><strong>{active?.productName ?? "Not currently active"}</strong></div><div className="club-detail-row"><span>Gym access</span><strong>{item.profile.access?.state === "active" ? "Active" : "Unavailable"}</strong></div><p className="muted">Digital access isn&apos;t available in R12 yet.</p></Surface><Surface className="member-hub-section"><span className="eyebrow">CLASSES</span>{upcoming.length ? upcoming.map(session => <div className="club-detail-row" key={session.id}><span><strong>{session.title ?? "Class"}</strong><small>{date(session.startsAt)}</small></span><span className="muted">{item.bookings.some(b => b.sessionId === session.id && b.status !== "cancelled") ? "Booked" : "Available"}</span></div>) : <p className="muted">No upcoming classes are available.</p>}<Link className="member-hub-link" href={`/member-hub/classes?org=${encodeURIComponent(item.organisation.id)}`}>View classes</Link></Surface><Surface className="member-hub-section member-hub-orders-summary"><div className="section-heading-row"><span className="eyebrow">RECENT ORDERS</span>{ownOrders.length ? <span className="muted">Latest {ownOrders.length}</span> : null}</div>{ownOrders.length ? ownOrders.map(order => <div className="club-detail-row" key={order.id}><span>{order.items.map(line => `${line.productName} ×${line.quantity}`).join(", ")}</span><strong>{money(order.totalMinor, order.currency)}</strong></div>) : <p className="muted">Your orders will appear here.</p>}<Link className="member-hub-link" href={shopHref}>View shop orders</Link></Surface></div>; })}</AppShell>;
}
