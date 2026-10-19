import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { GlowZoneCustomerView } from "@/components/glow-zone-customer-view";

export default async function GlowZonePage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const c = await serverSupabase(); const { data: { user } } = await c.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const ctx = await resolveClubOrganisationContext(c, user.id, (await searchParams)?.org); if (!ctx) return <AppShell><PageHeader title="GLOW ZONE"/><p>Connect your gym to view GLOW ZONE.</p></AppShell>;
  const profile=await ctx.repository.getMemberOperationalProfile(ctx.organisation.id,user.id);
  return <GlowZoneCustomerView organisationId={ctx.organisation.id} userId={user.id} activeGymMembership={profile.memberships.some(x=>x.status==="active")} memberNavigation/>;
}
