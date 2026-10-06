import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { listClubOrganisationContexts } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { ClubJoiningForm } from "@/components/club-joining-form";

export default async function ClubJoinPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/account?mode=signIn&next=%2Fclub%2Fjoin");
  const [{ data: orgData }, contexts] = await Promise.all([supabase.rpc("club_list_joinable_organisations"), listClubOrganisationContexts(supabase, user.id)]);
  const organisations = Array.isArray(orgData) ? orgData as Array<{ id: string; name: string; slug: string }> : [];
  const requestedId = (await searchParams)?.org; const organisation = organisations.find(item => item.id === requestedId) ?? (organisations.length === 1 ? organisations[0] : undefined);
  if (!organisation) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Start joining" description="Choose a gym to see its current membership options." />{organisations.length ? <Surface><div className="quick-grid">{organisations.map(item => <Link key={item.id} href={`/club/join?org=${encodeURIComponent(item.id)}`}><strong>{item.name}</strong><small>View membership options</small></Link>)}</div></Surface> : <EmptyState title="Joining is not available yet">Ask your gym for the current join link.</EmptyState>}<AppNav /></AppShell>;
  const context = contexts.find(item => item.organisation.id === organisation.id);
  const [{ data: productData }, { data: locationData }, { data: joinState }] = await Promise.all([
    supabase.rpc("club_list_joinable_memberships", { p_organisation_id: organisation.id }), supabase.rpc("club_list_join_locations", { p_organisation_id: organisation.id }), supabase.rpc("club_get_my_join_state", { p_organisation_id: organisation.id }),
  ]);
  const products = (Array.isArray(productData) ? productData : []).map(item => ({ id: String(item.id), name: String(item.name), priceMinor: Number(item.price_minor), joiningFeeMinor: Number(item.joining_fee_minor ?? 0), joiningFeeConfigured: item.joining_fee_configured !== false, checkoutKind: String(item.checkout_kind ?? "one_off"), billing: String(item.billing), ...(item.duration_days != null ? { durationDays: Number(item.duration_days) } : {}) }));
  const locations = (Array.isArray(locationData) ? locationData : []).map(item => ({ id: String(item.id), name: String(item.name) }));
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · JOINING" title={organisation.name} description="Choose a live membership and continue with your personal account." />{context ? <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /> : null}<ClubJoiningForm organisationId={organisation.id} products={products} locations={locations} accountEmail={user.email ?? ""} initialState={(joinState ?? null) as never} /><AppNav /></AppShell>;
}
