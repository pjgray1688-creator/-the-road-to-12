import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { serverSupabase } from "@/lib/supabase-server";
import { ClubPromotions } from "@/components/club-promotions";
export default async function ClubPromotionsPage({searchParams}:{searchParams?:Promise<{org?:string}>}) { const client=await serverSupabase(); const {data:{user}}=await client.auth.getUser(); if(!user) redirect("/account?mode=signIn"); const context=await resolveClubOrganisationContext(client,user.id,(await searchParams)?.org); if(!context || !(await context.repository.hasCapability(context.organisation.id,user.id,"commerce.pricing_manage"))) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Promotions & offers"/><EmptyState title="Promotion access required">Only authorised Club managers can create offers.</EmptyState><AppNav/></AppShell>; return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · SHOP" title="Promotions & offers" description="Schedule customer offers without changing catalogue prices."/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><ClubPromotions organisationId={context.organisation.id}/><AppNav/></AppShell>; }
