import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubMembershipPaymentReview } from "@/components/club-membership-payment-review";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

type PaymentRow = { id: string; method: string; state: string; amount_minor: number; currency: string; external_reference?: string; evidence_note: string; payment_received_at: string; initiated_at: string; provisional_expires_at?: string; customer_name?: string; product_name?: string; location_name?: string };

export default async function MembershipPaymentReviewPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context) return <AppShell className="module-page club-page"><EmptyState title="Club access required">Choose an authorised organisation.</EmptyState><AppNav /></AppShell>;
  const [canTake, canViewFinance, canVerify, canCorrect, result] = await Promise.all([
    context.repository.hasCapability(context.organisation.id, user.id, "payments.take"),
    context.repository.hasCapability(context.organisation.id, user.id, "finance.view"),
    context.repository.hasCapability(context.organisation.id, user.id, "membership_payments.verify"),
    context.repository.hasCapability(context.organisation.id, user.id, "finance.manage"),
    client.rpc("club_list_membership_counter_payments", { p_organisation_id: context.organisation.id }),
  ]);
  if (!canTake && !canViewFinance && !canVerify) return <AppShell className="module-page club-page"><EmptyState title="Payment status access required">You do not have permission to view counter-payment status.</EmptyState><AppNav /></AppShell>;
  const rows = Array.isArray(result.data) ? result.data as PaymentRow[] : []; const query = `?org=${encodeURIComponent(context.organisation.id)}`;
  const money = (row: PaymentRow) => new Intl.NumberFormat("en-GB", { style: "currency", currency: row.currency }).format(row.amount_minor / 100);
  return <AppShell className="module-page club-page"><PageHeader title="Membership payments" description="Review counter evidence, bounded provisional access and bank-transfer claims." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />
    {result.error ? <Surface><EmptyState title="Payment recording is not installed">Apply the reviewed January 27 migration before recording counter payments.</EmptyState></Surface> : rows.length ? rows.map(row => <Surface key={row.id}>
      <div className="club-detail-row"><span><strong>{row.customer_name ?? "Member"} · {row.product_name ?? "Membership"}</strong><small>{row.method.replaceAll("_", " ")} · {row.location_name ?? "Venue"} · received/claimed {new Date(row.payment_received_at).toLocaleString("en-GB")} · recorded {new Date(row.initiated_at).toLocaleString("en-GB")}{row.external_reference ? ` · Ref ${row.external_reference}` : ""}</small><small>{row.evidence_note}</small><small>{row.provisional_expires_at ? `Provisional access until ${new Date(row.provisional_expires_at).toLocaleString("en-GB")}` : row.method === "bank_transfer" ? "No access activated from this bank claim" : "No provisional period recorded"}</small></span><strong>{row.state.replaceAll("_", " ")} · {money(row)}</strong></div>
      {row.state === "pending_verification" && canVerify ? <ClubMembershipPaymentReview organisationId={context.organisation.id} paymentId={row.id} state={row.state} /> : row.state !== "pending_verification" && canCorrect ? <ClubMembershipPaymentReview organisationId={context.organisation.id} paymentId={row.id} state={row.state} canCorrect /> : row.state === "pending_verification" && !canVerify ? <p className="muted">Management verification remains outstanding.</p> : null}
    </Surface>) : <Surface><EmptyState title="No membership payments">There is no counter-payment evidence recorded.</EmptyState></Surface>}
    <BackButton href={`/club/payments${query}`}>Back to Finance</BackButton><AppNav /></AppShell>;
}
