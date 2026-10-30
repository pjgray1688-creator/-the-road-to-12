import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubFamilyContractTerms } from "@/components/club-family-contract-terms";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

type FamilyContract = { membership_id: string; agreed_amount_minor?: number; currency?: string; frequency?: string; billing_state?: string; paid_through_date?: string; provider_reconciliation_state: string; club_customers?: { display_name?: string } };

export default async function MembershipAdministrationPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "memberships.manage"))) return <AppShell className="module-page club-page"><EmptyState title="Membership management access required">You do not have this management capability.</EmptyState><AppNav /></AppShell>;
  const [canSetPricing, result] = await Promise.all([context.repository.hasCapability(context.organisation.id, user.id, "memberships.pricing_sensitive"), client.from("club_membership_shared_contracts").select("membership_id,agreed_amount_minor,currency,frequency,billing_state,paid_through_date,provider_reconciliation_state,club_customers!responsible_payer_customer_id(display_name)").eq("organisation_id", context.organisation.id).eq("arrangement_kind", "family")]);
  const rows = (result.data ?? []) as unknown as FamilyContract[]; const query = `?org=${encodeURIComponent(context.organisation.id)}`;
  return <AppShell className="module-page club-page"><PageHeader title="Membership administration" description="Shared contracts, payment evidence and controlled membership terms." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />
    <Surface><div className="club-profile-grid"><Link className="club-detail-row" href={`/club/members${query}`}><strong>Member directory</strong><span className="muted">Memberships, holders and access details.</span></Link><Link className="club-detail-row" href={`/club/payments/membership${query}`}><strong>Membership payment verification</strong><span className="muted">Review in-gym cash, bank transfer and external-terminal evidence.</span></Link></div></Surface>
    {result.error ? <Surface><EmptyState title="Family terms controls are not installed">Apply the reviewed manual migration before managing negotiated contract terms.</EmptyState></Surface> : rows.map(row => <Surface key={row.membership_id}><h2>{row.club_customers?.display_name ?? "Family contract"}</h2><p className="muted">Responsible payer on file · provider reconciliation {row.provider_reconciliation_state.replaceAll("_", " ")}</p>{canSetPricing ? <ClubFamilyContractTerms organisationId={context.organisation.id} membershipId={row.membership_id} currentAmountMinor={row.agreed_amount_minor} currentFrequency={row.frequency} currentState={row.billing_state} paidThroughDate={row.paid_through_date} /> : <p className="muted">Only Peter, Keenan or an explicitly delegated sensitive-pricing holder may change negotiated amounts.</p>}</Surface>)}
    <AppNav /></AppShell>;
}
