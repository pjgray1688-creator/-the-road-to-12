import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { clubRepository } from "@/lib/club-repository";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";

const money = (minor: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
const date = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export default async function MemberOrders({ searchParams }: { searchParams?: Promise<{ org?: string; order?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fmember-hub%2Forders");
  const params = await searchParams; const { data } = await client.rpc("club_list_my_memberships"); const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  const row = rows.find(value => String((value.organisation as Record<string, unknown> | undefined)?.id) === params?.org) ?? rows[0];
  if (!row) return <AppShell className="module-page member-area-page"><PageHeader title="Order history" /><EmptyState title="Connect your gym first">Your orders will appear once a membership is linked.</EmptyState></AppShell>;
  const org = row.organisation as Record<string, unknown>; const organisationId = String(org.id); const repository = clubRepository(client); const profile = await repository.getMemberOperationalProfile(organisationId, user.id);
  const orders = (await repository.listOrders(organisationId)).filter(order => order.userId === user.id || (profile.customer?.id && order.customerId === profile.customer.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selected = params?.order ? orders.find(order => order.id === params.order) : undefined;
  return <AppShell className="module-page club-page member-area-page"><PageHeader title={selected ? "Order receipt" : "Order history"} description={String(org.name)} />{selected ? <Surface className="member-order-receipt"><p className="eyebrow">ORDER {selected.id.slice(0, 8).toUpperCase()}</p><p className="muted">{date(selected.createdAt)} · {selected.status}</p>{selected.items.map(item => <div className="club-detail-row" key={item.id}><span><strong>{item.productName}</strong><small>{item.quantity} × {money(item.unitPriceMinor, selected.currency)}</small></span><strong>{money(item.lineTotalMinor, selected.currency)}</strong></div>)}<div className="club-detail-row"><span>Total</span><strong>{money(selected.totalMinor, selected.currency)}</strong></div><p className="muted">Payment and fulfilment status: {selected.status}.</p><a className="back-button" href={`/member-hub/orders?org=${encodeURIComponent(organisationId)}`}>Back to order history</a></Surface> : orders.length ? <Surface className="member-order-history"><span className="eyebrow">PREVIOUS PURCHASES</span>{orders.map(order => <a className="navigation-row" key={order.id} href={`/member-hub/orders?org=${encodeURIComponent(organisationId)}&order=${encodeURIComponent(order.id)}`}><span><strong>{date(order.createdAt)}</strong><small>{order.items.map(item => `${item.productName} ×${item.quantity}`).join(", ")}</small></span><b>{money(order.totalMinor, order.currency)}</b></a>)}</Surface> : <EmptyState title="No orders yet">Completed and pending purchases will appear here.</EmptyState>}</AppShell>;
}
