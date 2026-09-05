import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { listClubOrganisationContexts } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";

export default async function ClubJoinPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/account?mode=signIn&next=%2Fclub%2Fjoin");
  const contexts = await listClubOrganisationContexts(supabase, user.id); const organisationId = (await searchParams)?.org; const context = organisationId ? contexts.find(item => item.organisation.id === organisationId) : contexts.length === 1 ? contexts[0] : undefined;
  if (!context) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Joining" description="Membership options are available through Madhouse reception." /><EmptyState title="Club account not linked">Ask the Madhouse team to link your Club account before choosing a membership.</EmptyState><AppNav /></AppShell>;
  const products = (await context.repository.listProducts(context.organisation.id)).filter(product => product.kind === "membership" && product.sellable && !product.archivedAt);
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · JOINING" title="Membership options" description="Current sellable membership products from your Club catalogue." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} />{products.length ? <div className="club-profile-grid">{products.map(product => <Surface key={product.id}><span className="eyebrow">{product.billing === "recurring" ? "RECURRING" : "ONE-OFF"}</span><h2>{product.name}</h2><p>£{(product.priceMinor / 100).toFixed(2)}{product.durationDays ? ` · ${product.durationDays} days` : ""}</p>{product.entitlements?.length ? <p className="muted">Includes {product.entitlements.map(item => item.entitlementKey.replace(/[_-]+/g, " ")).join(", ")}.</p> : null}<p className="muted">Membership assignment and payment confirmation are completed by authorised Madhouse staff.</p></Surface>)}</div> : <Surface><div className="empty-state"><strong>No memberships are currently available to join</strong><p>Ask reception for the next available option.</p></div></Surface>}<Link className="text-button" href={`/club?org=${encodeURIComponent(context.organisation.id)}`}>Back to Club</Link><AppNav /></AppShell>;
}
