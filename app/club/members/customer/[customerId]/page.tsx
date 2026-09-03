import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader, Surface } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubMembershipAssignment } from "@/components/club-membership-assignment";
import { ClubCustomerLink } from "@/components/club-customer-link";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext, isClubStaffRole } from "@/lib/club-server-context";

export default async function ClubCustomerProfilePage({ params, searchParams }: { params: Promise<{ customerId: string }>; searchParams?: Promise<{ org?: string }> }) {
  const supabase = await serverSupabase(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(supabase, user.id, (await searchParams)?.org);
  if (!context || !isClubStaffRole(context.role)) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Customer" description="This profile is not available." /><EmptyState title="Club access required">Ask an organisation owner to confirm your operational role.</EmptyState><AppNav /></AppShell>;
  const route = await params;
  const customer = (await context.repository.listCustomers(context.organisation.id)).find(item => item.id === decodeURIComponent(route.customerId));
  if (!customer) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Customer" description="Operational profile." /><EmptyState title="Customer not found">This person is not part of the selected organisation.</EmptyState><BackButton href={`/club/members?org=${encodeURIComponent(context.organisation.id)}`}>Back to members</BackButton><AppNav /></AppShell>;
  const [products, memberSummaries] = await Promise.all([context.repository.listProducts(context.organisation.id, true), context.repository.listMemberSummaries(context.organisation.id)]);
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · CUSTOMER" title={customer.displayName} description={customer.email ?? "Customer record"} /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} /><div className="club-profile-grid"><Surface><span className="eyebrow">IDENTITY</span><h2>{customer.displayName}</h2><p className="muted">{customer.email ?? "No email recorded"}</p><p className="muted">{customer.userId ? "R12 account linked" : "No R12 account linked"}</p>{!customer.userId ? <><p className="muted">Linking an account will make app and digital access benefits available.</p><ClubCustomerLink organisationId={context.organisation.id} customerId={customer.id} members={memberSummaries} /></> : null}</Surface><Surface><span className="eyebrow">MEMBERSHIP</span><h2>Record membership</h2><p className="muted">Commercial membership can be recorded without an R12 account. Payment is managed separately.</p>{["gym_admin", "owner"].includes(context.role) ? <ClubMembershipAssignment organisationId={context.organisation.id} customerId={customer.id} products={products} /> : null}</Surface></div><BackButton href={`/club/members?org=${encodeURIComponent(context.organisation.id)}`}>Back to members</BackButton><AppNav /></AppShell>;
}
