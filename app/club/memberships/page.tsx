import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubFamilyContractTerms } from "@/components/club-family-contract-terms";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { membershipManagementGroups } from "@/lib/club-membership-categories";
import { ClubLegacyMembershipReview } from "@/components/club-legacy-membership-review";

type FamilyContract = { membership_id: string; arrangement_kind: "family" | "couple"; agreed_amount_minor?: number; currency?: string; frequency?: string; billing_state?: string; paid_through_date?: string; provider_reconciliation_state: string; responsible_payer_name?: string };

export default async function MembershipAdministrationPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?app=club&mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "memberships.manage"))) return <AppShell className="module-page club-page"><EmptyState title="Membership management access required">You do not have this management capability.</EmptyState><AppNav /></AppShell>;
  const [canSetPricing, canImport, products, locations, result] = await Promise.all([
    context.repository.hasCapability(context.organisation.id, user.id, "memberships.pricing_sensitive"),
    context.repository.hasCapability(context.organisation.id, user.id, "members.import"),
    context.repository.listProducts(context.organisation.id, true),
    context.repository.listLocations(context.organisation.id),
    client.rpc("club_list_family_contracts_secure", { p_organisation_id: context.organisation.id }),
  ]);
  const reviewResult = canImport ? await client.rpc("club_list_legacy_membership_review", { p_organisation_id: context.organisation.id }) : null;
  const rows = Array.isArray(result.data) ? result.data as FamilyContract[] : [];
  const groups = membershipManagementGroups(products);
  const query = `?org=${encodeURIComponent(context.organisation.id)}`;
  return <AppShell className="module-page club-page"><PageHeader title="Membership administration" description="Shared contracts, payment evidence and controlled membership terms." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />
    <Surface><div className="club-profile-grid"><Link className="club-detail-row" href={`/club/payments/membership${query}`}><strong>Membership payment verification</strong><span className="muted">Review in-gym cash, bank transfer and external-terminal evidence.</span></Link></div></Surface>
    <Surface><h2>Membership categories</h2><p className="muted">Management catalogue view. Public sale availability is shown separately and does not hide historical product categories.</p><div className="club-profile-grid">{groups.map(group => <section key={group.key}><h3>{group.label}</h3>{group.products.length ? group.products.map(product => <p key={product.id}>{product.name} <span className="muted">· {product.archivedAt ? "Archived historical product" : product.sellable ? "Public sale enabled" : "Not on public sale"}</span></p>) : <p className="muted">No configured product found.</p>}</section>)}</div></Surface>
    {result.error ? <Surface><EmptyState title={result.error.code === "42P01" || result.error.code === "42703" || result.error.code === "42883" ? "Membership database update required" : result.error.code === "42501" ? "Family terms access unavailable" : "Family terms could not be loaded"}>{result.error.code === "42P01" || result.error.code === "42703" || result.error.code === "42883" ? "Apply the controlled family-contract read projection before using this section. No membership terms were changed." : result.error.code === "42501" ? "The current database access policy does not permit this read. No membership terms were changed." : "The secure family-contract projection returned an error. No membership terms were changed."}</EmptyState></Surface> : rows.length ? rows.map(row => <Surface key={row.membership_id}><h2>{row.arrangement_kind === "couple" ? "Couple contract" : "Family contract"} · {row.responsible_payer_name ?? "Payer not recorded"}</h2><p className="muted">Responsible payer · provider reconciliation {row.provider_reconciliation_state.replaceAll("_", " ")}</p>{canSetPricing ? <ClubFamilyContractTerms organisationId={context.organisation.id} membershipId={row.membership_id} currentAmountMinor={row.agreed_amount_minor} currentFrequency={row.frequency} currentState={row.billing_state} paidThroughDate={row.paid_through_date} /> : <p className="muted">Only authorised sensitive-pricing managers may view or change negotiated amounts.</p>}</Surface>) : <Surface><p className="muted">No negotiated Family or Couple contracts are recorded.</p></Surface>}
    {canImport ? reviewResult?.error ? <Surface><EmptyState title={reviewResult.error.code === "42883" || reviewResult.error.code === "42P01" ? "Historical review database update required" : "Historical review unavailable"}>The protected legacy-membership review projection is unavailable. No source records were changed.</EmptyState></Surface> : <ClubLegacyMembershipReview organisationId={context.organisation.id} candidates={Array.isArray(reviewResult?.data) ? reviewResult.data as never[] : []} products={products} locations={locations} /> : null}
    <AppNav /></AppShell>;
}
