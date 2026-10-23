import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubFinanceTrend } from "@/components/club-finance-trend";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { summariseReconciliation, summariseRecordedCollections, reconciliationCsv, filterCashAwaitingVerification, reconciliationState, collectibleMembershipRows, type ReconciliationOrder, type ReconciliationPayment } from "@/lib/club-reconciliation";
import { londonDateKey, resolveClubFinancePeriod } from "@/lib/club-finance-period";
import { ClubVoidOrder } from "@/components/club-void-order";

type Params = { org?: string; from?: string; to?: string; location?: string; preset?: string };
const GBP = (minor: number) => `£${(minor / 100).toFixed(2)}`;

export default async function ClubPaymentsPage({ searchParams }: { searchParams?: Promise<Params> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  const params = (await searchParams) ?? {};
  const context = await resolveClubOrganisationContext(client, user.id, params.org);
  if (!context || !["owner", "gym_admin"].includes(context.role) || !(await context.repository.hasCapability(context.organisation.id, user.id, "cash.reconcile"))) {
    return <AppShell className="module-page club-page"><PageHeader title="Payments" /><EmptyState title="Billing access required">Payment recovery is limited to authorised Club staff.</EmptyState><AppNav /></AppShell>;
  }
  const period = resolveClubFinancePeriod({ preset: params.preset, from: params.from, to: params.to });
  const from = period.from.toISOString();
  const to = period.to.toISOString();
  const [attentionResult, ordersResult, paymentsResult, refundsResult, cash, locations, memberSummaries] = await Promise.all([
    client.rpc("club_list_membership_billing_attention", { p_organisation_id: context.organisation.id }),
    client.from("club_orders").select("id,created_at,location_id,status,subtotal_minor,discount_minor,total_minor,currency,channel,club_order_items(product_name,quantity)").eq("organisation_id", context.organisation.id).gte("created_at", from).lte("created_at", to).order("created_at", { ascending: false }),
    client.from("club_payments").select("id,order_id,created_at,method,amount_minor,status,stripe_merchant_entity").eq("organisation_id", context.organisation.id).gte("created_at", from).lte("created_at", to),
    client.from("club_refunds").select("amount_minor,order_id,created_at").eq("organisation_id", context.organisation.id).gte("created_at", from).lte("created_at", to),
    context.repository.listCashDeclarations(context.organisation.id),
    context.repository.listLocations(context.organisation.id),
    context.repository.listMemberSummaries(context.organisation.id),
  ]);
  const canManagePromotions = await context.repository.hasCapability(context.organisation.id, user.id, "commerce.pricing_manage");
  const location = locations.some(item => item.id === params.location) ? params.location : undefined;
  const orders = ((ordersResult.data ?? []) as ReconciliationOrder[]).filter(order => !location || order.location_id === location);
  const orderIds = new Set(orders.map(order => order.id));
  const periodPayments = ((paymentsResult.data ?? []) as ReconciliationPayment[]);
  const refundRows = (refundsResult.data ?? []) as Array<{ amount_minor: number; order_id: string; created_at: string }>;
  const linkedIds = [...new Set([...periodPayments.map(payment => payment.order_id), ...refundRows.map(refund => refund.order_id)])];
  const linkedOrderResult = location && linkedIds.length ? await client.from("club_orders").select("id,location_id").eq("organisation_id", context.organisation.id).in("id", linkedIds) : null;
  const linkedLocation = new Map((linkedOrderResult?.data ?? []).map(row => [String(row.id), String(row.location_id ?? "")]));
  const selectedPayments = location ? periodPayments.filter(payment => linkedLocation.get(payment.order_id) === location) : periodPayments;
  const selectedRefunds = location ? refundRows.filter(refund => linkedLocation.get(refund.order_id) === location) : refundRows;
  const payments = periodPayments.filter(payment => orderIds.has(payment.order_id));
  const refunds = selectedRefunds;
  const summary = summariseReconciliation(orders, payments, refunds);
  const periodRefundMinor = refunds.reduce((sum, refund) => sum + refund.amount_minor, 0);
  const netSales = summary.netMinor - periodRefundMinor;
  const pendingCash = filterCashAwaitingVerification(cash, period.from, period.to, location);
  const cashToVerify = pendingCash.reduce((sum, item) => sum + item.declaredAmountMinor, 0);
  const allBillingRows = Array.isArray(attentionResult.data) ? attentionResult.data as Array<Record<string, unknown>> : [];
  const billingRows = collectibleMembershipRows(allBillingRows);
  const orderRows = orders.filter(order => { const related = payments.filter(payment => payment.order_id === order.id); return order.total_minor > 0 && (order.status === "pending_payment" || order.status === "draft") && related.every(payment => payment.status !== "paid"); }).map(order => ({ id: `order-${order.id}`, payment_method_family: "Shop order", next_due_at: order.created_at, state: reconciliationState(order, payments), amount_minor: order.total_minor }));
  const rows: Array<Record<string, unknown>> = [...billingRows, ...orderRows];
  const collections = summariseRecordedCollections(selectedPayments);
  const paymentsReceived = collections.receivedMinor;
  const balanceSpending = collections.balanceMinor;
  const cards = [["Net sales", netSales], ["Payments received", paymentsReceived], ["Cash to verify", cashToVerify], ["Madhouse Balance spending", balanceSpending]] as const;
  const trendByDate = new Map<string, { net: number; payments: number }>();
  const ensure = (key: string) => { const point = trendByDate.get(key) ?? { net: 0, payments: 0 }; trendByDate.set(key, point); return point; };
  for (const order of orders) if (order.status === "paid" || order.status === "fulfilled") ensure(londonDateKey(order.created_at)).net += order.total_minor;
  for (const refund of refunds) ensure(londonDateKey(refund.created_at)).net -= refund.amount_minor;
  for (const payment of selectedPayments) if (payment.status === "paid" && payment.method !== "balance") ensure(londonDateKey(payment.created_at)).payments += payment.amount_minor;
  const trend = [...trendByDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, ...value, label: new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short" }), netMinor: value.net, paymentsMinor: value.payments }));
  const csv = reconciliationCsv(orders, payments);
  const orderItems = (order: ReconciliationOrder & { club_order_items?: Array<{ product_name?: string; quantity?: number }> }) => (order.club_order_items ?? []).map(item => `${item.product_name ?? "Item"} × ${item.quantity ?? 1}`).join(", ") || "Order items unavailable";
  const merchantLabels: Record<string, string> = { madhouse_franchise: "Franchise", madhouse_products_services: "Products & Services" };
  const breakdown = [["Gross sales", summary.grossMinor], ["Discounts", summary.discountMinor], ["Refunds", periodRefundMinor], ["Cash collected", collections.cashMinor], ["Madhouse Balance spending", balanceSpending], ["Card and other recorded payments", collections.otherMinor], ["Pending payment attempts", summary.pendingMinor], ["Failed payment attempts", summary.failedMinor], ["Complimentary value", summary.compValueMinor]] as const;
  return <AppShell className="module-page club-page club-finance-page"><PageHeader title="Finance" description="Recorded sales, collections, recovery and cash verification." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><Surface><nav className="club-shop-tabs" aria-label="Finance areas"><a href="#overview">Overview</a><a href="#transactions">Transactions</a><a href={`/club/membership-billing?org=${encodeURIComponent(context.organisation.id)}`}>Membership payments</a><a href={`/club/shop?org=${encodeURIComponent(context.organisation.id)}&view=cash`}>Cash verification</a><a href={`/club/reports?org=${encodeURIComponent(context.organisation.id)}`}>Reports</a>{canManagePromotions && <a href={`/club/promotions?org=${encodeURIComponent(context.organisation.id)}`}>Promotions</a>}</nav></Surface>
    <div id="overview"><Surface><form className="club-finance-filters" method="get"><input type="hidden" name="org" value={context.organisation.id}/><label>Period<select name="preset" defaultValue={period.preset}><option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom</option></select></label><label>From<input type="date" name="from" defaultValue={period.fromKey}/></label><label>To<input type="date" name="to" defaultValue={period.toKey}/></label><label>Location<select name="location" defaultValue={location ?? ""}><option value="">All locations</option>{locations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="secondary" type="submit">Apply</button></form></Surface></div>
    <div className="club-finance-kpis">{cards.map(([label, value]) => <Surface key={label}><span className="eyebrow">{label}</span><h2>{GBP(value)}</h2>{label === "Payments received" ? <small className="club-finance-kpi-note">Recorded Club cash/card collections only</small> : null}</Surface>)}</div><p className="club-finance-scope-note">Payments received excludes Madhouse Balance spending and recurring membership collections. It is not total income.</p>
    <Surface><ClubFinanceTrend points={trend} /></Surface>
    <Surface><div className="club-detail-row"><div><strong>Selected period</strong><span className="muted">{period.from.toLocaleDateString("en-GB", { timeZone: "Europe/London" })} – {period.to.toLocaleDateString("en-GB", { timeZone: "Europe/London" })}</span></div><a className="secondary" download="r12-reconciliation.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}>Export CSV</a></div></Surface>
    <details className="club-finance-breakdown"><summary>Detailed breakdown</summary><Surface>{breakdown.map(([label, amount]) => <div className="club-detail-row" key={label}><span>{label}</span><strong>{GBP(amount)}</strong></div>)}<p className="muted">Net sales uses completed shop/service orders less recorded refunds in this selected period. Payments received excludes Madhouse Balance spending and covers successful Club cash/card collection records created in the period. It is not total income: recurring membership collections are not included because no existing authorised reporting endpoint supplies their receipt events.</p></Surface></details>
    <div id="transactions"><Surface><span className="eyebrow">TRANSACTIONS</span>{orders.length ? orders.map(order => { const related = payments.filter(payment => payment.order_id === order.id); const routes = [...new Set(related.filter(payment => payment.method === "card").map(payment => merchantLabels[payment.stripe_merchant_entity ?? ""] ?? "Legacy/unverified Stripe route"))]; return <div className="club-detail-row" key={order.id}><div><strong>{orderItems(order as ReconciliationOrder & { club_order_items?: Array<{ product_name?: string; quantity?: number }> })}</strong><span className="muted">{new Date(order.created_at).toLocaleString("en-GB")} · {order.channel ?? "Channel not recorded"} · {order.status}{routes.length ? ` · Stripe: ${routes.join(", ")}` : ""}</span></div><strong>{GBP(order.total_minor)}</strong>{(order.status === "pending_payment" || order.status === "draft") && order.channel === "staff_checkout" ? <ClubVoidOrder organisationId={context.organisation.id} orderId={order.id} /> : null}</div>; }) : <p className="muted">No transactions in this period.</p>}</Surface></div>
    <Surface><span className="eyebrow">NEEDS ATTENTION</span>{rows.length ? rows.map(row => { const member = memberSummaries.find(item => item.userId === String(row.user_id ?? "")); const isMembership = row.membership_id != null; return <div className="club-detail-row" key={String(row.id)}><div><strong>{isMembership ? `${member?.displayName ?? "Member details unavailable"} · ${member?.membershipName ?? "Membership"}` : String(row.payment_method_family ?? "Payment")}</strong><span className="muted">{isMembership ? "Recoverable membership charge" : "Shop payment exception"} · Due {String(row.next_due_at ?? "date unavailable")} · {String(row.state)}</span></div><strong>{GBP(Number(row.amount_minor ?? 0))}</strong></div>; }) : <p className="muted">No overdue or recoverable membership payments need attention.</p>}<p className="muted">Membership recovery items use the existing authorised billing attention report and include only due, collectible charges. Amounts exclude future-dated dues and deduplicate retries.</p></Surface>
    <Surface><span className="eyebrow">CASH TO VERIFY</span><p className="muted">{GBP(cashToVerify)} in declared cash awaiting authorised verification during this period.</p><p className="muted">Pending payments: {GBP(summary.pendingMinor)} · Failed attempts: {GBP(summary.failedMinor)} · Complimentary value: {GBP(summary.compValueMinor)}</p></Surface><AppNav /></AppShell>;
}
