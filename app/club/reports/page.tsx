import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { summariseReconciliation, type ReconciliationOrder, type ReconciliationPayment } from "@/lib/club-reconciliation";

export default async function ClubReportsPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !["owner", "gym_admin"].includes(context.role) || !(await context.repository.hasCapability(context.organisation.id, user.id, "cash.reconcile"))) {
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · FINANCE" title="Reports" /><EmptyState title="Reporting access required">Reports are limited to authorised Club managers.</EmptyState><AppNav /></AppShell>;
  }
  const from = new Date(); from.setDate(1); from.setHours(0, 0, 0, 0);
  const financeResult = await client.rpc("club_list_finance_reconciliation", { p_organisation_id: context.organisation.id, p_from: from.toISOString(), p_to: new Date().toISOString(), p_location_id: null });
  const financeData = financeResult.data && typeof financeResult.data === "object" ? financeResult.data as { orders?: ReconciliationOrder[]; payments?: ReconciliationPayment[]; refunds?: Array<{amount_minor:number;order_id:string}> } : {};
  const orders = Array.isArray(financeData.orders) ? financeData.orders : [];
  const payments = Array.isArray(financeData.payments) ? financeData.payments : [];
  const summary = summariseReconciliation(orders, payments, financeData.refunds ?? []);
  const money = (minor: number) => `£${(minor / 100).toFixed(2)}`;
  const stripeMerchants = ["madhouse_franchise", "madhouse_products_services", "legacy_or_unverified"] as const;
  const merchantNames: Record<string, string> = { madhouse_franchise: "Franchise", madhouse_products_services: "Products & Services", legacy_or_unverified: "Unverified/legacy route" };
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · FINANCE" title="Reports" description="Authoritative sales and payment summaries for the current month." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />{financeResult.error?<EmptyState title="Finance data unavailable">Authorised transaction data could not be loaded.</EmptyState>:<><Surface><span className="eyebrow">CURRENT MONTH</span><div className="club-profile-grid"><div><strong>Sales</strong><p>{money(summary.grossMinor)}</p></div><div><strong>Discounts</strong><p>{money(summary.discountMinor)}</p></div><div><strong>Net sales</strong><p>{money(summary.netMinor)}</p></div><div><strong>Refunds</strong><p>{money(summary.refundMinor)}</p></div></div></Surface><Surface><span className="eyebrow">PAYMENT METHOD BREAKDOWN</span>{["cash", "balance", "card", "bank_transfer"].map(method => { const value = payments.filter(payment => payment.method === method && payment.status === "paid").reduce((sum, payment) => sum + payment.amount_minor, 0); return <div className="club-detail-row" key={method}><span>{method === "bank_transfer" ? "Bank transfer" : method.replace("_", " ")}</span><strong>{money(value)}</strong></div>; })}<span className="eyebrow">STRIPE MERCHANT ROUTING</span>{stripeMerchants.map(entity => { const value = payments.filter(payment => payment.method === "card" && payment.status === "paid" && (payment.stripe_merchant_entity ?? "legacy_or_unverified") === entity).reduce((sum, payment) => sum + payment.amount_minor, 0); return <div className="club-detail-row" key={entity}><span>{merchantNames[entity]}</span><strong>{money(value)}</strong></div>; })}</Surface></>}<BackButton href={`/club/payments?org=${encodeURIComponent(context.organisation.id)}`}>Back to Finance</BackButton><AppNav /></AppShell>;
}
