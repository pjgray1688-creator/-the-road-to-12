import { redirect } from "next/navigation";
import { AppShell, PageHeader, Surface } from "@/components/ui";
import { AppNav } from "@/components/app-nav";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { GLOW_ZONE_LOCATION, glowZoneHours, glowZonePackages, glowZoneSafety } from "@/lib/glow-zone";
import { getGlowBalanceAction } from "@/app/club/sunbeds/actions";
import { GlowZoneActivity } from "@/components/glow-zone-activity";

export default async function GlowZonePage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const c = await serverSupabase(); const { data: { user } } = await c.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const ctx = await resolveClubOrganisationContext(c, user.id, (await searchParams)?.org); if (!ctx) return <AppShell><PageHeader title="GLOW ZONE"/><p>Connect your gym to view GLOW ZONE.</p></AppShell>;
  const profile = await ctx.repository.getMemberOperationalProfile(ctx.organisation.id, user.id); const balance = await getGlowBalanceAction({ organisationId: ctx.organisation.id, userId: user.id });
  const minutes = balance.ok ? balance.balance.minutes : profile.serviceCredits.filter(x => x.creditKey === "sunbed_minutes").reduce((n, x) => n + x.balanceQuantity, 0); const member = profile.memberships.some(x => x.status === "active");
  return <AppShell className="module-page member-area-page glow-zone-page"><div className="glow-zone-atmosphere" aria-hidden="true"/><PageHeader eyebrow="GLOW ZONE" title="GLOW ZONE" description={`Sunbeds at ${GLOW_ZONE_LOCATION}.`}/><Surface><span className="eyebrow glow-green">MY GLOW</span><h2 className="glow-balance">{minutes} minutes available</h2>{balance.ok && balance.balance.next_expiry ? <p className="muted">Next expiry: {new Date(balance.balance.next_expiry).toLocaleDateString("en-GB")}</p> : null}<p className="muted">Reception can find your account by name.</p><span className="glow-pass-status">GLOW PASS · COMING SOON</span></Surface><GlowZoneActivity organisationId={ctx.organisation.id} userId={user.id}/><Surface><span className="eyebrow glow-pink">BUY MINUTES</span>{glowZonePackages.filter(p => member || !p.membersOnly).map(p => <div className="glow-package-row" key={p.id}><span><strong>{p.name}</strong><small>{p.minutes} minutes</small>{p.membersOnly ? <small>Member price</small> : null}</span><strong className="glow-price">£{(p.priceMinor / 100).toFixed(2)}</strong></div>)}<div className="glow-package-row"><span><strong>PAY AS YOU GO</strong><small>£1 / minute</small><small>Purchase at reception</small></span></div></Surface><Surface><span className="eyebrow">OPENING HOURS</span>{glowZoneHours.map(x => <p className="muted" key={x}>{x}</p>)}</Surface><Surface><span className="eyebrow">BEFORE YOU TAN</span>{glowZoneSafety().map(x => <p className="muted" key={x}>{x}</p>)}</Surface><AppNav/></AppShell>;
}
