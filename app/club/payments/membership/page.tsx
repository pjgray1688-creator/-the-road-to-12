import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubMembershipPaymentReview } from "@/components/club-membership-payment-review";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

type PaymentRow = { id: string; method: string; amount_minor: number; currency: string; external_reference?: string; evidence_note: string; initiated_at: string; club_customers?: { display_name?: string }; club_products?: { name?: string }; club_locations?: { name?: string } };

export default async function MembershipPaymentReviewPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "finance.view"))) return <AppShell className="module-page club-page"><EmptyState title="Finance access required">You do not have permission to review membership payments.</EmptyState><AppNav /></AppShell>;
  const [canVerify, result] = await Promise.all([context.repository.hasCapability(context.organisation.id, user.id, "membership_payments.verify"), client.from("club_membership_counter_payments").select("id,method,amount_minor,currency,external_reference,evidence_note,initiated_at,club_customers(display_name),club_products(name),club_locations(name)").eq("organisation_id", context.organisation.id).eq("state", "pending_verification").order("initiated_at", { ascending: false })]);
  const rows = (result.data ?? []) as unknown as PaymentRow[]; const query = `?org=${encodeURIComponent(context.organisation.id)}`;
  return <AppShell className="module-page club-page"><PageHeader title="Membership payments" description="Pending in-gym evidence. Access remains inactive until authorised verification." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />
    {result.error ? <Surface><EmptyState title="Payment recording is not installed">The reviewed manual database migration must be applied before counter-payment evidence can be recorded.</EmptyState></Surface> : rows.length ? rows.map(row => <Surface key={row.id}><div className="club-detail-row"><span><strong>{row.club_customers?.display_name ?? "Member"} · {row.club_products?.name ?? "Membership"}</strong><small>{row.method.replaceAll("_", " ")} · {row.club_locations?.name ?? "Venue"} · {new Date(row.initiated_at).toLocaleString("en-GB")}{row.external_reference ? ` · Ref ${row.external_reference}` : ""}</small><small>{row.evidence_note}</small></span><strong>{new Intl.NumberFormat("en-GB", { style: "currency", currency: row.currency }).format(row.amount_minor / 100)}</strong></div>{canVerify ? <ClubMembershipPaymentReview organisationId={context.organisation.id} paymentId={row.id} /> : <p className="muted">A delegated payment verifier must review this evidence.</p>}</Surface>) : <Surface><EmptyState title="No pending membership payments">There is no counter-payment evidence awaiting verification.</EmptyState></Surface>}
    <BackButton href={`/club/payments${query}`}>Back to Finance</BackButton><AppNav /></AppShell>;
}
