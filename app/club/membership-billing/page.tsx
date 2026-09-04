import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

export default async function MemberBillingPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context) return <AppShell><EmptyState title="Club membership unavailable">Your account is not linked to an active Club organisation.</EmptyState><AppNav /></AppShell>;
  const { data } = await client.rpc("club_get_member_billing", { p_organisation_id: context.organisation.id, p_user_id: user.id });
  const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
  return <AppShell className="module-page club-page"><PageHeader eyebrow="MADHOUSE MEMBERSHIP" title="Membership payments" description="Your recurring Club membership payment status." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />{rows.length ? <Surface>{rows.map(row => <div className="club-detail-row" key={String(row.id)}><div><strong>{String(row.state ?? "upcoming")}</strong><span className="muted">Next payment {String(row.next_due_at ?? "to be confirmed")} · {String(row.payment_method_family ?? "payment method not set")}</span></div><strong>£{(Number(row.amount_minor ?? 0) / 100).toFixed(2)}</strong></div>)}</Surface> : <Surface><div className="empty-state"><strong>No recurring payment schedule yet</strong><p>Your Club membership payment details will appear here once configured.</p></div></Surface>}<AppNav /></AppShell>;
}
