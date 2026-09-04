import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

export default async function ClubPaymentsPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "payments.take"))) {
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · BILLING" title="Payments" /><EmptyState title="Billing access required">Payment recovery is limited to authorised Club staff.</EmptyState><AppNav /></AppShell>;
  }
  const { data } = await client.rpc("club_list_membership_billing_attention", { p_organisation_id: context.organisation.id });
  const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · BILLING" title="Payments needing attention" description="Review failed membership payments and recovery states." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><Surface>{rows.length ? rows.map(row => <div className="club-detail-row" key={String(row.id)}><div><strong>{String(row.payment_method_family ?? "Membership payment")}</strong><span className="muted">Due {String(row.next_due_at ?? "date unavailable")} · {String(row.state)}</span></div><strong>£{(Number(row.amount_minor ?? 0) / 100).toFixed(2)}</strong></div>) : <div className="empty-state"><span className="eyebrow">BILLING</span><strong>No payment issues need attention</strong><p>Upcoming and recovered memberships stay out of this exception view.</p></div>}</Surface><AppNav /></AppShell>;
}
