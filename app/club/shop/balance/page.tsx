import { redirect } from "next/navigation";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { AppNav } from "@/components/app-nav";
import { AppShell, EmptyState, PageHeader } from "@/components/ui";
import { ClubSectionNav } from "@/components/club-shell";
import { ClubBalanceTopUp } from "@/components/club-balance-top-up";

export default async function BalanceTopUpPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase(); const { data: { user } } = await client.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org); if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "payments.record_cash"))) return <AppShell><PageHeader eyebrow="MADHOUSE BALANCE" title="Quick top up" /><EmptyState title="Access required">Cash balance top-ups are limited to authorised reception staff.</EmptyState><AppNav /></AppShell>;
  const [customers, locations] = await Promise.all([context.repository.listCustomers(context.organisation.id), context.repository.listLocations(context.organisation.id)]);
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · BALANCE" title="Madhouse Balance" description="Record a cash top-up for a linked member." /><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts} locations={locations} /><ClubBalanceTopUp organisationId={context.organisation.id} locationId={locations.find(item => item.active)?.id} customers={customers} /><AppNav /></AppShell>;
}
