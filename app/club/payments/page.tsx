import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { summariseReconciliation, reconciliationCsv, type ReconciliationOrder, type ReconciliationPayment } from "@/lib/club-reconciliation";

export default async function ClubPaymentsPage({ searchParams }: { searchParams?: Promise<{ org?: string; from?: string; to?: string; location?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !["owner", "gym_admin"].includes(context.role) || !(await context.repository.hasCapability(context.organisation.id, user.id, "cash.reconcile"))) {
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · BILLING" title="Payments" /><EmptyState title="Billing access required">Payment recovery is limited to authorised Club staff.</EmptyState><AppNav /></AppShell>;
  }
  const params = await searchParams; const now = new Date(); const from = params?.from ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString(); const to = params?.to ?? now.toISOString();
  const [attentionResult, ordersResult, paymentsResult, refundsResult, cash, locations] = await Promise.all([
    client.rpc("club_list_membership_billing_attention", { p_organisation_id: context.organisation.id }),
    client.from("club_orders").select("id,created_at,location_id,status,subtotal_minor,discount_minor,total_minor,currency,channel").eq("organisation_id", context.organisation.id).gte("created_at", from).lte("created_at", to).order("created_at", { ascending: false }),
    client.from("club_payments").select("id,order_id,created_at,method,amount_minor,status").eq("organisation_id", context.organisation.id).gte("created_at", from).lte("created_at", to),
    client.from("club_refunds").select("amount_minor,order_id").eq("organisation_id", context.organisation.id),
    context.repository.listCashDeclarations(context.organisation.id),
    context.repository.listLocations(context.organisation.id)
  ]);
  const location = params?.location; const orders = ((ordersResult.data ?? []) as ReconciliationOrder[]).filter(order => !location || order.location_id === location); const orderIds = new Set(orders.map(order => order.id)); const payments = ((paymentsResult.data ?? []) as ReconciliationPayment[]).filter(payment => orderIds.has(payment.order_id)); const summary = summariseReconciliation(orders, payments, (refundsResult.data ?? []) as Array<{ amount_minor: number; order_id: string }>); const cashRecorded = cash.filter(item => item.status === "confirmed" && (!location || item.locationId === location)).reduce((sum,item)=>sum+item.declaredAmountMinor,0); const data = attentionResult.data;
  const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  const cards = [["Gross sales",summary.grossMinor],["Discounts",summary.discountMinor],["Net sales",summary.netMinor],["Payments received",summary.paidMinor],["Recorded cash",cashRecorded],["Madhouse Balance spend",summary.balanceMinor],["External payments",summary.externalMinor],["Refunds",summary.refundMinor],["Outstanding",summary.unpaidMinor]] as const;
  const csv = reconciliationCsv(orders,payments);
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · FINANCE" title="Financial reconciliation" description="Recorded R12 activity for the selected period. Provider settlement is shown only when recorded." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><Surface><form className="club-detail-row" method="get"><input type="hidden" name="org" value={context.organisation.id}/><label>From<input type="date" name="from" defaultValue={from.slice(0,10)}/></label><label>To<input type="date" name="to" defaultValue={to.slice(0,10)}/></label><label>Location<select name="location" defaultValue={location ?? ""}><option value="">All locations</option>{locations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="secondary" type="submit">Apply</button></form></Surface><div className="club-profile-grid">{cards.map(([label,value])=><Surface key={label}><span className="eyebrow">{label}</span><h2>£{(value/100).toFixed(2)}</h2></Surface>)}</div><Surface><div className="club-detail-row"><div><strong>Period</strong><span className="muted">{new Date(from).toLocaleDateString("en-GB")} – {new Date(to).toLocaleDateString("en-GB")}</span></div><a className="secondary" download="r12-reconciliation.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}>Export CSV</a></div></Surface><Surface><span className="eyebrow">NEEDS ATTENTION</span>{rows.length ? rows.map(row => <div className="club-detail-row" key={String(row.id)}><div><strong>{String(row.payment_method_family ?? "Membership payment")}</strong><span className="muted">Due {String(row.next_due_at ?? "date unavailable")} · {String(row.state)}</span></div><strong>£{(Number(row.amount_minor ?? 0) / 100).toFixed(2)}</strong></div>) : <p className="muted">No unresolved membership payment exceptions.</p>}</Surface><Surface><span className="eyebrow">RECONCILIATION</span><p className="muted">R12 recorded cash: £{(cashRecorded/100).toFixed(2)}. Balance top-ups and later Balance spending remain separate events; Balance spending is not additional cash received.</p><p className="muted">Pending payments: £{(summary.pendingMinor/100).toFixed(2)} · Failed attempts: £{(summary.failedMinor/100).toFixed(2)} · Complimentary value: £{(summary.compValueMinor/100).toFixed(2)}</p></Surface><AppNav /></AppShell>;
}
