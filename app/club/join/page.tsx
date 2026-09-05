import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { listClubOrganisationContexts } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { ClubJoiningForm } from "@/components/club-joining-form";
import { MemberClubUnavailable } from "@/components/club-member-home";

export default async function ClubJoinPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/account?mode=signIn&next=%2Fclub%2Fjoin");
  const contexts = await listClubOrganisationContexts(supabase, user.id); const organisationId = (await searchParams)?.org; const context = organisationId ? contexts.find(item => item.organisation.id === organisationId) : contexts.length === 1 ? contexts[0] : undefined;
  if (!context && !organisationId) {
    const { data } = await supabase.rpc("club_list_joinable_organisations");
    const organisations = Array.isArray(data) ? data as Array<{ id: string; name: string }> : [];
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Start joining" description="Choose a Club organisation to see its current membership options." />{organisations.length ? <Surface><div className="quick-grid">{organisations.map(item => <Link key={item.id} href={`/club/join?org=${encodeURIComponent(item.id)}`}><strong>{item.name}</strong><small>View membership options</small></Link>)}</div></Surface> : <MemberClubUnavailable />}<AppNav /></AppShell>;
  }
  if (!context && organisationId) {
    const { data } = await supabase.rpc("club_list_joinable_organisations"); const organisation = (Array.isArray(data) ? data as Array<{ id: string; name: string; slug: string; active: boolean }> : []).find(item => item.id === organisationId);
    if (!organisation) return <MemberClubUnavailable />;
    const { data: productData } = await supabase.rpc("club_list_joinable_memberships", { p_organisation_id: organisationId });
    const products = (Array.isArray(productData) ? productData : []).map(item => { const product = item as Record<string, unknown>; return { id: String(product.id), name: String(product.name), priceMinor: Number(product.price_minor), billing: String(product.billing), ...(product.duration_days != null ? { durationDays: Number(product.duration_days) } : {}) }; });
    return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · JOINING" title={organisation.name} description="Choose a current sellable membership and record your joining details." /><ClubJoiningForm organisationId={organisationId} products={products} /><AppNav /></AppShell>;
  }
  const { data: productData } = await supabase.rpc("club_list_joinable_memberships", { p_organisation_id: context!.organisation.id });
  const products = (Array.isArray(productData) ? productData : []).map(item => { const product = item as Record<string, unknown>; return { id: String(product.id), name: String(product.name), priceMinor: Number(product.price_minor), billing: String(product.billing), ...(product.duration_days != null ? { durationDays: Number(product.duration_days) } : {}) }; });
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · JOINING" title="Membership options" description="Current sellable membership products from your Club catalogue." /><ClubSectionNav organisation={context!.organisation} role={context!.role} contexts={context!.availableContexts} /><ClubJoiningForm organisationId={context!.organisation.id} products={products} /><Link className="text-button" href={`/club?org=${encodeURIComponent(context!.organisation.id)}`}>Back to Club</Link><AppNav /></AppShell>;
}
