import { redirect } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { launchReadiness } from "@/lib/launch-readiness";
import { siteUrl } from "@/lib/site-url";
import { serverSupabase } from "@/lib/supabase-server";

const stateLabel = { configured: "Configured", missing: "Missing", invalid: "Invalid", disabled: "Disabled", adapter_unavailable: "Adapter unavailable", external_verification_required: "External verification required" };

export default async function ClubLaunchReadinessPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fclub%2Flaunch-readiness");
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !["owner", "gym_admin"].includes(context.role)) return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Launch readiness"/><EmptyState title="Admin access required">Only authorised Club administrators can inspect deployment configuration status.</EmptyState><AppNav/></AppShell>;
  const checks = launchReadiness();
  const q = `?org=${encodeURIComponent(context.organisation.id)}`;
  const appOrigin = siteUrl();
  return <AppShell className="module-page club-page">
    <PageHeader eyebrow="R12 CLUB · ADMIN" title="Launch readiness" description="Configuration presence and format only. Secret values and live connectivity are never shown or tested."/>
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/>
    <Surface><span className="eyebrow">SERVER CONFIGURATION</span><div className="club-list">{checks.map(check=><article className="club-detail-row" key={check.key}><span><strong>{check.label}</strong><small>{check.detail}</small></span><b aria-label={`${check.label}: ${stateLabel[check.state]}`}>{stateLabel[check.state]}</b></article>)}</div><Link className="member-hub-link" href={`/club/launch-readiness/stripe${q}`}>Run read-only Stripe merchant verification</Link></Surface>
    <Surface><span className="eyebrow">PROVIDER DESTINATIONS</span><div className="club-list">
      <div className="club-detail-row"><span><strong>Madhouse Franchise Limited Stripe webhook</strong><small>Membership Checkout, recurring subscriptions/invoices, refunds and disputes. Rotherham and Carlton share this account.</small></span><code>{appOrigin}/api/webhooks/stripe</code></div>
      <div className="club-detail-row"><span><strong>Madhouse Products and Services Limited Stripe webhook</strong><small>Explicitly routed one-off shop and approved service purchases only; separate account and signing secret.</small></span><code>{appOrigin}/api/webhooks/stripe/products-services</code></div>
      <div className="club-detail-row"><span><strong>GoCardless webhook</strong><small>Enable payment and mandate lifecycle events.</small></span><code>{appOrigin}/api/webhooks/gocardless</code></div>
      <div className="club-detail-row"><span><strong>GoCardless callback</strong><small>Used by hosted mandate setup.</small></span><code>{appOrigin}/api/club/join/gocardless/complete</code></div>
      <div className="club-detail-row"><span><strong>Billing worker</strong><small>GET · Vercel Cron runs daily at 06:00 UTC; Authorization uses CRON_SECRET. Due collections may wait until the next run.</small></span><code>{appOrigin}/api/internal/membership-billing-worker</code></div>
      <div className="club-detail-row"><span><strong>Notification worker</strong><small>GET · Staff invite/resend and member-import activation actions nudge this authenticated outbox worker after responding. Vercel Cron provides a daily 06:15 UTC safety sweep; SMTP must be configured before messages can be claimed. Up to 1,000 messages per run within the bounded worker budget.</small></span><code>{appOrigin}/api/internal/notification-worker</code></div>
    </div><p className="muted">Supabase Auth confirmation and password-reset mail is configured separately in Supabase. Verify its Site URL, redirect allow-list and hosted template before invites.</p></Surface>
    <Surface><span className="eyebrow">SENDER IDENTITIES</span><div className="club-list">{[["Member and account mail","members@r12.live"],["Staff mail","staff@r12.live"],["Madhouse billing","madhouse.accounts@r12.live"]].map(([label,address])=><div className="club-detail-row" key={address}><strong>{label}</strong><code>{address}</code></div>)}</div><p className="muted">Sender domain authentication must be verified with SpaceMail. This page never tests SMTP connectivity or displays credentials.</p><Link href={`/club/staff/email-preview${q}`} className="member-hub-link">Preview and test emails</Link></Surface>
    <Link className="member-hub-link" href={`/club/more${q}`}>Back to More</Link><AppNav/>
  </AppShell>;
}
