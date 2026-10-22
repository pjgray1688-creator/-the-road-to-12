import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { inspectStripeReadiness } from "@/lib/stripe-readiness-diagnostic";
import { hasPlayReviewerEntitlement } from "@/lib/play-reviewer";
import { serverSupabase } from "@/lib/supabase-server";

const label = (value: string) => value.replaceAll("_", " ").replaceAll("-", " ");

export const dynamic = "force-dynamic";

export default async function StripeReadinessPage({ searchParams }: { searchParams?: Promise<{ org?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fclub%2Flaunch-readiness%2Fstripe");
  if (hasPlayReviewerEntitlement(user)) return <AppShell className="module-page club-page"><PageHeader title="Stripe verification"/><EmptyState title="Admin access required">Payment diagnostics are not available to reviewer accounts.</EmptyState><AppNav/></AppShell>;
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org);
  if (!context || !["owner", "gym_admin"].includes(context.role)) return <AppShell className="module-page club-page"><PageHeader title="Stripe verification"/><EmptyState title="Admin access required">Only authorised Club administrators can run read-only merchant verification.</EmptyState><AppNav/></AppShell>;

  const result = await inspectStripeReadiness();
  const q = `?org=${encodeURIComponent(context.organisation.id)}`;
  return <AppShell className="module-page club-page">
    <PageHeader eyebrow="R12 CLUB · PRIVILEGED READ ONLY" title="Stripe merchant verification" description="Checks configured key mode, the account identity returned by Stripe, and webhook-secret presence. This page does not create Checkout Sessions or read customer or payment records."/>
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/>
    <Surface><span className="eyebrow">LIVE MERCHANTS</span><div className="club-list">{result.merchants.map(merchant=><article className="club-detail-row" key={merchant.entity}><span><strong>{merchant.entity === "madhouse_franchise" ? "Madhouse Franchise Ltd" : "Madhouse Products & Services Ltd"}</strong><small>Configuration: {label(merchant.configuration)} · Mode: {label(merchant.mode)} · Account ID: {label(merchant.accountIdentity)} · Legal entity name: {label(merchant.legalEntityIdentity)} · Webhook secret: {label(merchant.webhookSecret)} · Live Checkout gate: {label(merchant.liveCheckoutGate)}</small></span><b>{merchant.accountIdentity === "confirmed" && merchant.legalEntityIdentity === "confirmed" && merchant.mode === "live" ? "Read-only checks passed" : "Blocked / incomplete"}</b><div>{merchant.requiredPermissions.map(permission=><small key={permission}>{permission}</small>)}<small>Checkout write permission: deliberately not probed.</small></div></article>)}</div><p className="muted">The two configured account IDs are {label(result.accountIdsDistinct)} distinct. No account details or customer data are shown.</p></Surface>
    <Surface><span className="eyebrow">WEBHOOKS</span><p>Franchise and Products &amp; Services production signing secrets: {result.merchants.every(merchant=>merchant.webhookSecret === "configured") ? "configured in server environment" : "missing or invalid"}.</p><p>Products &amp; Services class webhook secret: {label(result.classWebhookSecret)}. All three webhook routes verify Stripe signatures in application code. The Stripe Dashboard endpoint-to-secret association is not readable through this diagnostic.</p><p className="muted">Checkout write permissions are not tested here because doing so requires creating a Stripe Checkout Session. Use a separately authorised controlled payment test after configuration is confirmed.</p></Surface>
    <Link className="member-hub-link" href={`/club/launch-readiness${q}`}>Back to launch readiness</Link><AppNav/>
  </AppShell>;
}
