import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { summariseReconciliation, reconciliationCsv, classifyReconciliationOrders, completedCardTotalsByMerchant, type ReconciliationOrder, type ReconciliationPayment } from "@/lib/club-reconciliation";
import { ClubFinanceTransactionTables } from "@/components/club-finance-transaction-tables";
import { ClubVoidOrder } from "@/components/club-void-order";
import { comparePeriodValues, parseClubFinanceMemberCounts, parseGlowZoneFinanceReport, summarizeCompletedGlowSales } from "@/lib/glow-zone-finance";

export default async function ClubPaymentsPage({ searchParams }: { searchParams?: Promise<{ org?: string; from?: string; to?: string; location?: string; view?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "finance.view"))) {
    return <AppShell className="module-page club-page"><PageHeader title="Finance" /><EmptyState title="Billing access required">Finance is limited to authorised Club staff.</EmptyState><AppNav /></AppShell>;
  }
  const params = await searchParams; const now = new Date(); const requestedFrom = params?.from ? new Date(`${params.from}T00:00:00.000Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); const requestedTo = params?.to ? new Date(`${params.to}T23:59:59.999Z`) : now; const fromDate = Number.isNaN(requestedFrom.getTime()) ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) : requestedFrom; const toDate = Number.isNaN(requestedTo.getTime()) ? now : requestedTo; if (fromDate > toDate) fromDate.setTime(toDate.getTime()); const from = fromDate.toISOString(); const to = toDate.toISOString();
  const attemptsOnly = params?.view === "attempts";
  const rangeLength = toDate.getTime() - fromDate.getTime();
  const monthToDate = fromDate.getUTCDate() === 1 && fromDate.getUTCMonth() === now.getUTCMonth() && fromDate.getUTCFullYear() === now.getUTCFullYear() && toDate <= now;
  const previousToDate = monthToDate
    ? new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth() - 1, Math.min(toDate.getUTCDate(), new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), 0)).getUTCDate()), 23, 59, 59, 999))
    : new Date(fromDate.getTime() - 1);
  const previousFromDate = monthToDate
    ? new Date(Date.UTC(previousToDate.getUTCFullYear(), previousToDate.getUTCMonth(), 1))
    : new Date(previousToDate.getTime() - rangeLength);
  const previousFrom = previousFromDate.toISOString(); const previousTo = previousToDate.toISOString();
  const [financeResult, glowSalesResult, previousFinanceResult, previousGlowResult, memberCountsResult, locations] = await Promise.all([
    client.rpc("club_list_finance_reconciliation", { p_organisation_id: context.organisation.id, p_from: from, p_to: to, p_location_id: params?.location ?? null }),
    client.rpc("club_list_glow_finance_report", { p_organisation_id: context.organisation.id, p_from: from, p_to: to, p_location_id: params?.location ?? null }),
    client.rpc("club_list_finance_reconciliation", { p_organisation_id: context.organisation.id, p_from: previousFrom, p_to: previousTo, p_location_id: params?.location ?? null }),
    client.rpc("club_list_glow_finance_report", { p_organisation_id: context.organisation.id, p_from: previousFrom, p_to: previousTo, p_location_id: params?.location ?? null }),
    client.rpc("club_finance_member_counts_secure", { p_organisation_id: context.organisation.id }),
    context.repository.listLocations(context.organisation.id)
  ]);
  if (financeResult.error) console.error("R12_FINANCE_READ_FAILED", { stage: "club_list_finance_reconciliation", code: financeResult.error.code ?? "UNKNOWN" });
  if (glowSalesResult.error) console.error("R12_FINANCE_READ_FAILED", { stage: "glow_zone_sales", code: glowSalesResult.error.code ?? "UNKNOWN" });
  if (memberCountsResult.error) console.error("R12_FINANCE_READ_FAILED", { stage: "membership_counts", code: memberCountsResult.error.code ?? "UNKNOWN" });
  const location = locations.some(item=>item.id===params?.location) ? params?.location : undefined;
  const financeData = financeResult.data && typeof financeResult.data === "object" ? financeResult.data as { orders?: ReconciliationOrder[]; payments?: ReconciliationPayment[]; refunds?: Array<{amount_minor:number;order_id:string;created_at:string}> } : {};
  const orders = Array.isArray(financeData.orders) ? financeData.orders : []; const payments = Array.isArray(financeData.payments) ? financeData.payments : []; const refunds = Array.isArray(financeData.refunds) ? financeData.refunds : []; const summary = summariseReconciliation(orders, payments, refunds);
  const financeDataValid = Array.isArray(financeData.orders) && Array.isArray(financeData.payments) && Array.isArray(financeData.refunds);
  const financeDataUnavailable = Boolean(financeResult.error) || !financeDataValid;
  if (!financeResult.error && !financeDataValid) console.error("R12_FINANCE_READ_FAILED", { stage: "club_list_finance_reconciliation", code: "INVALID_PAYLOAD" });
  const glowReport = parseGlowZoneFinanceReport(glowSalesResult.data);
  const glowSales = summarizeCompletedGlowSales(glowReport?.records ?? [], { from, to, locationId: location });
  const glowSalesMinor = glowSales.amountMinor;
  const glowSalesUnavailable = Boolean(glowSalesResult.error) || !glowReport;
  if (!glowSalesResult.error && !glowReport) console.error("R12_FINANCE_READ_FAILED", { stage: "glow_zone_sales", code: "INVALID_PAYLOAD" });
  const memberCounts = parseClubFinanceMemberCounts(memberCountsResult.data);
  if (!memberCountsResult.error && !memberCounts) console.error("R12_FINANCE_READ_FAILED", { stage: "membership_counts", code: "INVALID_PAYLOAD" });
  const previousFinance = previousFinanceResult.data && typeof previousFinanceResult.data === "object" ? previousFinanceResult.data as { orders?: ReconciliationOrder[]; payments?: ReconciliationPayment[]; refunds?: Array<{ amount_minor: number; order_id: string }> } : undefined;
  const previousFinanceAvailable = !previousFinanceResult.error && Array.isArray(previousFinance?.orders) && Array.isArray(previousFinance?.payments) && Array.isArray(previousFinance?.refunds);
  const previousGlowReport = parseGlowZoneFinanceReport(previousGlowResult.data);
  const previousGlowAvailable = !previousGlowResult.error && Boolean(previousGlowReport);
  const freshReceiptTotal = (items: ReconciliationPayment[]) => items.filter(payment => payment.status === "paid" && !["balance", "wallet"].includes(payment.method)).reduce((sum, payment) => sum + payment.amount_minor, 0);
  const cardRoutesVerified = payments.filter(payment => payment.status === "paid" && payment.method === "card").every(payment => payment.stripe_merchant_entity === "madhouse_products_services");
  const previousCardRoutesVerified = previousFinance?.payments?.filter(payment => payment.status === "paid" && payment.method === "card").every(payment => payment.stripe_merchant_entity === "madhouse_products_services") ?? false;
  const pAndSReceipts = financeDataUnavailable || !cardRoutesVerified ? undefined : freshReceiptTotal(payments) - summary.refundMinor;
  const previousSummary = previousFinanceAvailable ? summariseReconciliation(previousFinance!.orders!, previousFinance!.payments!, previousFinance!.refunds!) : undefined;
  const previousGlowSales = previousGlowAvailable ? summarizeCompletedGlowSales(previousGlowReport!.records, { from: previousFrom, to: previousTo, locationId: location }) : undefined;
  const previousPAndSReceipts = previousSummary && previousCardRoutesVerified ? freshReceiptTotal(previousFinance!.payments!) - previousSummary.refundMinor : undefined;
  const pAndSComparison = pAndSReceipts !== undefined && previousPAndSReceipts !== undefined ? comparePeriodValues(pAndSReceipts, previousPAndSReceipts) : undefined;
  const glowSalesComparison = !glowSalesUnavailable && previousGlowSales ? comparePeriodValues(glowSalesMinor, previousGlowSales.amountMinor) : undefined;
  const { sales: transactionOrders, attempts: checkoutAttempts } = classifyReconciliationOrders(orders);
  const venueMemberCount = (needle: string) => memberCounts?.locations.find(item => item.name.toLocaleLowerCase().includes(needle))?.activeMembers;
  const cards = [
    { title: "Total active members", value: memberCounts ? String(memberCounts.activeMembers) : "Unavailable", detail: memberCounts ? `${memberCounts.unassignedMembers} unassigned · ${memberCounts.conflictingHomeLocations} conflicting home-gym assignments · snapshot ${new Date(memberCounts.asOf).toLocaleDateString("en-GB")}` : "The secure membership count could not be loaded." },
    { title: "Rotherham home gym", value: venueMemberCount("rotherham") === undefined ? "Unavailable" : String(venueMemberCount("rotherham")), detail: "Distinct current active membership holders assigned to Rotherham." },
    { title: "Carlton home gym", value: venueMemberCount("carlton") === undefined ? "Unavailable" : String(venueMemberCount("carlton")), detail: "Distinct current active membership holders assigned to Carlton." },
    { title: "Total business income", value: "Incomplete", detail: "A reconciled total across joining fees, recurring receipts, refunds and Glow Zone is not yet available." },
    { title: "Franchise / membership income", value: "Unavailable", detail: "No unified report yet reconciles joining payments, recurring billing, verified offline receipts and membership refunds." },
    { title: "Products & Services income", value: pAndSReceipts === undefined ? "Incomplete" : `£${(pAndSReceipts / 100).toFixed(2)}`, detail: pAndSReceipts === undefined ? "Commerce data must load and card receipts must have a verified Products & Services route." : "Confirmed non-balance commerce receipts with verified Products & Services card routing, less recorded commerce refunds. Glow Zone sales and membership income are excluded." },
    { title: "Glow Zone sales", value: glowSalesUnavailable ? "Unavailable" : `£${(glowSalesMinor / 100).toFixed(2)}`, detail: glowSalesUnavailable ? "The secure Glow Zone finance report did not load." : `${glowSales.count} completed purchases · ${glowReport?.minutes_sold ?? 0} minutes sold. Reported separately from commerce income.` },
  ];
  const cardPaymentsByMerchant = completedCardTotalsByMerchant(orders, payments);
  const glowCsvRows = glowSales.records.map(sale => [sale.created_at,sale.id,sale.location_id,"glow_zone_minute_sale",(Number(sale.amount_minor)/100).toFixed(2),"0.00",(Number(sale.amount_minor)/100).toFixed(2),sale.tender_type,"","completed","completed"].map(value => `"${String(value).replaceAll('"','""')}"`).join(","));
  const csv = [reconciliationCsv(orders,payments), ...glowCsvRows].join("\n");
  const orderItems = (order: ReconciliationOrder & { club_order_items?: Array<{ product_name?: string; quantity?: number }> }) => (order.club_order_items ?? []).map(item => `${item.product_name ?? "Item"} × ${item.quantity ?? 1}`).join(", ") || "Order items unavailable";
  const merchantLabels: Record<string, string> = { madhouse_franchise: "Franchise", madhouse_products_services: "Products & Services" };
  const salesRows = transactionOrders.map(order => { const related = payments.filter(payment => payment.order_id === order.id); const routes = [...new Set(related.filter(payment => payment.method === "card").map(payment => merchantLabels[payment.stripe_merchant_entity ?? ""] ?? "Legacy/unverified Stripe route"))]; return { id: order.id, description: orderItems(order as ReconciliationOrder & { club_order_items?: Array<{ product_name?: string; quantity?: number }> }), createdAt: order.created_at, status: order.status, totalMinor: order.total_minor, paymentRoute: routes.join(", ") || undefined, canVoid: ["pending_payment", "draft"].includes(order.status) && order.channel === "staff_checkout" }; });
  const attemptRows = checkoutAttempts.map(order => { const related = payments.filter(payment => payment.order_id === order.id); const status = related.some(payment => payment.status === "failed") ? "Payment failed" : related.some(payment => payment.status === "pending") ? "Payment pending" : order.status; return { id: order.id, description: orderItems(order as ReconciliationOrder & { club_order_items?: Array<{ product_name?: string; quantity?: number }> }), createdAt: order.created_at, status, totalMinor: order.total_minor, canVoid: ["pending_payment", "draft"].includes(order.status) && order.channel === "staff_checkout" }; });
  return <AppShell className="module-page club-page"><PageHeader title={attemptsOnly ? "Checkout attempts" : "Finance & sales"} /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />
    <Surface><form className="club-detail-row club-finance-filters" method="get"><input type="hidden" name="org" value={context.organisation.id}/>{attemptsOnly ? <input type="hidden" name="view" value="attempts"/> : null}<label>From<input type="date" name="from" defaultValue={from.slice(0,10)}/></label><label>To<input type="date" name="to" defaultValue={to.slice(0,10)}/></label><label>Location<select name="location" defaultValue={location ?? ""}><option value="">All locations</option>{locations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="secondary" type="submit">Apply</button></form></Surface>
    {financeDataUnavailable ? <EmptyState title="Finance data unavailable">Authorised transaction data could not be loaded.</EmptyState> : null}
    {!attemptsOnly ? <><div className="club-profile-grid club-finance-kpis">{cards.map(card=><Surface key={card.title}><span className="eyebrow">{card.title}</span><h2>{card.value}</h2><small className="club-finance-kpi-definition">{card.detail}</small>{card.title === "Products & Services income" ? <small className="club-finance-kpi-definition">{pAndSComparison ? `Previous equivalent period £${(previousPAndSReceipts!/100).toFixed(2)} · ${pAndSComparison.difference >= 0 ? "+" : "−"}£${(Math.abs(pAndSComparison.difference)/100).toFixed(2)}${pAndSComparison.percentage === undefined ? " · percentage unavailable (zero baseline)" : ` · ${pAndSComparison.percentage >= 0 ? "+" : ""}${pAndSComparison.percentage.toFixed(1)}%`}` : "Period comparison unavailable."}</small> : null}{card.title === "Glow Zone sales" ? <small className="club-finance-kpi-definition">{glowSalesComparison ? `Previous equivalent period £${(previousGlowSales!.amountMinor/100).toFixed(2)} · ${glowSalesComparison.difference >= 0 ? "+" : "−"}£${(Math.abs(glowSalesComparison.difference)/100).toFixed(2)}${glowSalesComparison.percentage === undefined ? " · percentage unavailable (zero baseline)" : ` · ${glowSalesComparison.percentage >= 0 ? "+" : ""}${glowSalesComparison.percentage.toFixed(1)}%`}` : "Period comparison unavailable."}</small> : null}</Surface>)}</div><Surface><p role="status" className="club-finance-warning"><strong>Financial report is incomplete.</strong> {financeDataUnavailable ? "Commerce transaction data could not be loaded. " : ""}{!memberCounts ? "The active-membership count did not load. " : ""} Membership income is not included: the current report does not yet reconcile membership joining receipts, recurring collections and refunds into one authoritative period total. Products &amp; Services income excludes Glow Zone sales.</p></Surface><Surface><div className="club-detail-row"><div><strong>Reporting period</strong><span className="muted">{new Date(from).toLocaleDateString("en-GB")} – {new Date(to).toLocaleDateString("en-GB")}</span></div><a className="secondary club-finance-export" download="r12-reconciliation.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`}>Export CSV</a></div><a className="secondary" href={`/club/more?org=${encodeURIComponent(context.organisation.id)}&section=finance`}>Finance reports and reconciliation</a></Surface><Surface><strong>Confirmed card receipts by merchant</strong><div className="club-detail-row"><span>Products &amp; Services <small>Paid card records on completed commerce orders.</small></span><strong>£{((cardPaymentsByMerchant.madhouse_products_services ?? 0)/100).toFixed(2)}</strong></div><div className="club-detail-row"><span>Franchise <small>Membership billing is reported separately.</small></span><strong>£{((cardPaymentsByMerchant.madhouse_franchise ?? 0)/100).toFixed(2)}</strong></div><p className="muted">Merchant figures are order-payment records, not settlement totals; processor fees and bank settlements are not available in this report.</p></Surface></> : null}
    <div className="club-finance-desktop-only"><ClubFinanceTransactionTables organisationId={context.organisation.id} sales={salesRows} attempts={attemptRows} showSales={!attemptsOnly} showAttempts={attemptsOnly}/></div>
    <div className="club-finance-mobile-only"><Surface><span className="eyebrow">{attemptsOnly ? "CHECKOUT ATTEMPTS" : "COMPLETED TRANSACTIONS"}</span>{(attemptsOnly ? attemptRows : salesRows).length ? (attemptsOnly ? attemptRows : salesRows).map(row=><div className="club-detail-row" key={row.id}><div><strong>{row.description}</strong><span className="muted">{new Date(row.createdAt).toLocaleString("en-GB")} · {row.status}{"paymentRoute" in row && row.paymentRoute ? ` · ${row.paymentRoute}` : ""}</span></div><strong>£{(row.totalMinor/100).toFixed(2)}</strong>{row.canVoid ? <ClubVoidOrder organisationId={context.organisation.id} orderId={row.id}/> : null}</div>) : <p className="muted">{attemptsOnly ? "No checkout attempts in this period." : "No completed transactions in this period."}</p>}</Surface></div>
    <AppNav /></AppShell>;
}
