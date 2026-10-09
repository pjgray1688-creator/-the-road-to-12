import { redirect } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { launchReadiness } from "@/lib/launch-readiness";
import { serverSupabase } from "@/lib/supabase-server";

const stateLabel = { configured: "Configured", missing: "Missing", invalid: "Invalid" };

export default async function ClubLaunchReadinessPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fclub%2Flaunch-readiness");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !["owner", "gym_admin"].includes(context.role)) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Launch readiness"/><EmptyState title="Admin access required">Only authorised Club administrators can inspect deployment configuration status.</EmptyState><AppNav/></AppShell>;
  const checks = launchReadiness();
  const q = `?org=${encodeURIComponent(context.organisation.id)}`;
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB · ADMIN" title="Launch readiness" description="Configuration presence only. Secret values are never shown or tested from this screen."/><ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/><Surface><span className="eyebrow">SERVER CONFIGURATION</span><div className="club-list">{checks.map(check=><article className="club-detail-row" key={check.key}><span><strong>{check.label}</strong><small>{check.detail}</small></span><b aria-label={`${check.label}: ${stateLabel[check.state]}`}>{stateLabel[check.state]}</b></article>)}</div></Surface><Surface><span className="eyebrow">PROVIDER DESTINATIONS</span><div className="club-list"><div className="club-detail-row"><span><strong>Stripe webhook</strong><small>Register checkout completion, async success/failure, expired sessions and failed payment intents.</small></span><code>https://the-road-to-12.vercel.app/api/webhooks/stripe</code></div><div className="club-detail-row"><span><strong>GoCardless webhook</strong><small>Enable payment and mandate lifecycle events.</small></span><code>https://the-road-to-12.vercel.app/api/webhooks/gocardless</code></div><div className="club-detail-row"><span><strong>GoCardless callback</strong><small>Used by hosted mandate setup.</small></span><code>https://the-road-to-12.vercel.app/api/club/join/gocardless/complete</code></div><div className="club-detail-row"><span><strong>Billing worker</strong><small>GET · Authorization: Bearer worker secret · recommended hourly schedule.</small></span><code>https://the-road-to-12.vercel.app/api/internal/membership-billing-worker</code></div><div className="club-detail-row"><span><strong>Notification worker</strong><small>GET · Authorization: Bearer worker secret · requires a live email adapter for outbound email.</small></span><code>https://the-road-to-12.vercel.app/api/internal/notification-worker</code></div></div></Surface><Surface><span className="eyebrow">SENDER IDENTITIES</span><div className="club-list">{[["Member and account mail","members@r12.live"],["Staff mail","staff@r12.live"],["Madhouse billing","madhouse.accounts@r12.live"]].map(([label,address])=><div className="club-detail-row" key={address}><strong>{label}</strong><code>{address}</code></div>)}</div><p className="muted">Supabase Auth confirmation and password-reset SMTP is configured separately in Supabase and is not readable by this application check.</p></Surface><Link className="member-hub-link" href={`/club/more${q}`}>Back to More</Link><AppNav/></AppShell>;
}
