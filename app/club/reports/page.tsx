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
  if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !["owner", "gym_admin"].includes(context.role) || !(await context.repository.hasCapability(context.organisation.id, user.id, "cash.reconcile"))) {
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · FINANCE" title="Reports" /><EmptyState title="Reporting access required">Reports are limited to authorised Club managers.</EmptyState><AppNav /></AppShell>;
  }
  const from = new Date(); from.setDate(1); from.setHours(0, 0, 0, 0);
  const [ordersResult, paymentsResult] = await Promise.all([
    client.from("club_orders").select("id,created_at,location_id,status,subtotal_minor,discount_minor,total_minor,currency,channel").eq("organisation_id", context.organisation.id).gte("created_at", from.toISOString()),
    client.from("club_payments").select("id,order_id,created_at,method,amount_minor,status").eq("organisation_id", context.organisation.id).gte("created_at", from.toISOString()),
  ]);
  const orders = (ordersResult.data ?? []) as ReconciliationOrder[];
  const payments = (paymentsResult.data ?? []) as ReconciliationPayment[];
  const summary = summariseReconciliation(orders, payments);
  const money = (minor: number) => `£${(minor / 100).toFixed(2)}`;
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · FINANCE" title="Reports" description="Authoritative sales and payment summaries for the current month." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><Surface><span className="eyebrow">CURRENT MONTH</span><div className="club-profile-grid"><div><strong>Sales</strong><p>{money(summary.grossMinor)}</p></div><div><strong>Discounts</strong><p>{money(summary.discountMinor)}</p></div><div><strong>Net sales</strong><p>{money(summary.netMinor)}</p></div><div><strong>Refunds</strong><p>{money(summary.refundMinor)}</p></div><div><strong>Outstanding</strong><p>{money(summary.unpaidMinor)}</p></div></div></Surface><Surface><span className="eyebrow">PAYMENT METHOD BREAKDOWN</span>{["cash", "balance", "card", "bank_transfer"].map(method => { const value = payments.filter(payment => payment.method === method && payment.status === "paid").reduce((sum, payment) => sum + payment.amount_minor, 0); return <div className="club-detail-row" key={method}><span>{method === "bank_transfer" ? "Bank transfer" : method.replace("_", " ")}</span><strong>{money(value)}</strong></div>; })}</Surface><BackButton href={`/club/payments?org=${encodeURIComponent(context.organisation.id)}`}>Back to Finance</BackButton><AppNav /></AppShell>;
}
