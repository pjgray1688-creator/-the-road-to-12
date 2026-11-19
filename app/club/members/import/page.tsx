import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubMemberImport } from "@/components/club-member-import";
import { ClubPaymentReconciliationPreview } from "@/components/club-payment-reconciliation-preview";
import { ClubMemberActivationReadiness } from "@/components/club-member-activation-readiness";
import { ClubLegacyMembershipReview } from "@/components/club-legacy-membership-review";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";

export default async function ClubMemberImportPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase=await serverSupabase(); const {data:{user}}=await supabase.auth.getUser(); if(!user) redirect("/account?app=club&mode=signIn"); const context=await resolveClubOrganisationContext(supabase,user.id,(await searchParams)?.org);
  if(!context || !(await context.repository.hasCapability(context.organisation.id,user.id,"members.import"))) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · MEMBERS" title="Member import" description="Owner-authorised ClubManager migration." /><EmptyState title="Import access required">Only authorised owners or managers can stage a member migration.</EmptyState><AppNav/></AppShell>;
  const products = await context.repository.listProducts(context.organisation.id, true);
  const membershipProducts = products.filter(product => product.kind === "membership").map(product => ({ id: product.id, name: product.name, isLifetime: product.isLifetime === true, legacyImportCategory: product.legacyImportCategory, archived: Boolean(product.archivedAt), fixedTermValue: product.fixedTermValue, fixedTermUnit: product.fixedTermUnit }));
  const [readinessResult, reviewResult, locations] = await Promise.all([
    supabase.rpc("club_get_member_activation_readiness", { p_organisation_id: context.organisation.id }),
    supabase.rpc("club_list_legacy_membership_review", { p_organisation_id: context.organisation.id }),
    context.repository.listLocations(context.organisation.id),
  ]);
  const readiness = readinessResult.data && typeof readinessResult.data === "object" && Array.isArray((readinessResult.data as { people?: unknown }).people) ? (readinessResult.data as { people: Array<{ customerId: string; displayName: string; accountState: string; sharedMembershipReviewRequired: boolean; payerConfirmationRequired: boolean; payerRecordMissing: boolean }> }).people : [];
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · MEMBERS" title="Member import and maintenance" description="Import approved records and maintain historic membership mappings."/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><ClubMemberImport organisationId={context.organisation.id} membershipProducts={membershipProducts}/><ClubMemberActivationReadiness people={readiness}/><ClubPaymentReconciliationPreview organisationId={context.organisation.id}/><Surface><h2>Legacy membership mapping</h2><p className="muted">Maintenance tools for reviewing original imported offers and evidence. Saving a mapping does not activate access or change billing.</p>{reviewResult.error ? <EmptyState title="Legacy membership review unavailable">The protected review service is not available. No membership records were changed.</EmptyState> : <ClubLegacyMembershipReview organisationId={context.organisation.id} candidates={Array.isArray(reviewResult.data) ? reviewResult.data as never[] : []} products={products} locations={locations} />}</Surface><BackButton href={`/club/members?org=${encodeURIComponent(context.organisation.id)}`}>Back to members</BackButton><AppNav/></AppShell>;
}
