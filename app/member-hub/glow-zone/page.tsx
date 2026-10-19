import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/ui";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { GLOW_ZONE_LOCATION, glowZonePackages, glowZoneSafety } from "@/lib/glow-zone";
import { GlowZoneOpeningHours } from "@/components/glow-zone-opening-hours";
import type { GlowZoneHourRow } from "@/components/glow-zone-opening-hours";
import { getGlowBalanceAction } from "@/app/club/sunbeds/actions";
import { GlowZoneActivity } from "@/components/glow-zone-activity";


export default async function GlowZonePage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const c = await serverSupabase(); const { data: { user } } = await c.auth.getUser(); if (!user) redirect("/account?mode=signIn");
  const ctx = await resolveClubOrganisationContext(c, user.id, (await searchParams)?.org); if (!ctx) return <AppShell><PageHeader title="GLOW ZONE"/><p>Connect your gym to view GLOW ZONE.</p></AppShell>;
  const [profile,balance,hoursResult] = await Promise.all([ctx.repository.getMemberOperationalProfile(ctx.organisation.id,user.id),getGlowBalanceAction({organisationId:ctx.organisation.id,userId:user.id}),c.from("club_location_service_hours").select("weekday,opens_local,closes_local,confirmation_state,time_zone").eq("organisation_id",ctx.organisation.id).eq("location_name","Carlton").eq("service_key","sunbeds").order("weekday")]);
  const { data: glowHours } = hoursResult;
  const openingHours = (glowHours ?? []) as GlowZoneHourRow[];
  const member = profile.memberships.some(x => x.status === "active");
  return <AppShell className="module-page member-area-page glow-zone-page"><div className="glow-zone-atmosphere" aria-hidden="true"/><PageHeader eyebrow="GLOW ZONE" title="GLOW ZONE" description={`Sunbeds at ${GLOW_ZONE_LOCATION}.`}/><Surface><span className="eyebrow glow-green">MY GLOW</span>{balance.ok?<><h2 className="glow-balance">{balance.balance.minutes} minutes available</h2>{balance.balance.next_expiry?<p className="muted">Next expiry: {new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",dateStyle:"medium"}).format(new Date(balance.balance.next_expiry))}</p>:<p className="muted">No current expiry date.</p>}</>:<><h2 className="glow-balance">Balance temporarily unavailable</h2><p className="muted">Your current usable minutes could not be confirmed. Please try again shortly or ask reception.</p></>}<p className="muted">Only unexpired minutes are shown as available. Reception can find your account by name.</p><span className="glow-pass-status">GLOW PASS · COMING SOON</span></Surface><GlowZoneActivity organisationId={ctx.organisation.id} userId={user.id}/><Surface><span className="eyebrow glow-pink">BUY MINUTES</span>{glowZonePackages.filter(p => member || !p.membersOnly).map(p => <div className="glow-package-row" key={p.id}><span><strong>{p.name}</strong><small>{p.minutes} minutes</small>{p.membersOnly ? <small>Member price</small> : null}</span><strong className="glow-price">£{(p.priceMinor / 100).toFixed(2)}</strong></div>)}<div className="glow-package-row"><span><strong>PAY AS YOU GO</strong><small>£1 / minute</small><small>Purchase at reception</small></span></div></Surface><GlowZoneOpeningHours hours={openingHours}/><Surface><span className="eyebrow">BEFORE YOU TAN</span>{glowZoneSafety().map(x => <p className="muted" key={x}>{x}</p>)}</Surface><AppNav/></AppShell>;

}
