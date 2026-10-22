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
    <PageHeader eyebrow="R12 CLUB · PRIVILEGED READ ONLY" title="Stripe merchant verification" description="Separately checks signed merchant binding, API key authentication, and the read permission available to the self-account endpoint. Checkout permissions are never inferred or probed here."/>
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/>
    <Surface><span className="eyebrow">LIVE MERCHANTS</span><div className="club-list">{result.merchants.map(merchant=><article className="club-detail-row" key={merchant.entity}><span><strong>{merchant.entity === "madhouse_franchise" ? "Madhouse Franchise Ltd" : "Madhouse Products & Services Ltd"}</strong><small>Configuration: {label(merchant.configuration)} · Mode: {label(merchant.mode)} · Signed account binding: {label(merchant.accountBinding)} · API key authentication: {label(merchant.keyAuthentication)} · Self-account read: {label(merchant.selfAccountRead)} · Provider identity response: {label(merchant.providerIdentityMatch)} · Webhook secret: {label(merchant.webhookSecret)} · Live Checkout gate: {label(merchant.liveCheckoutGate)}</small></span><b>{merchant.accountBinding === "verified" && merchant.keyAuthentication === "accepted" && merchant.providerIdentityMatch !== "mismatch" && merchant.mode === "live" ? "Binding and key checks passed" : "Blocked / incomplete"}</b>{merchant.apiKeyFingerprint ? <small>SHA-256 API key fingerprint (non-secret approval binding): <code>{merchant.apiKeyFingerprint}</code></small> : null}{merchant.bindingApproval ? <small role="status">Approval record: {merchant.bindingApproval.approvedAt} · approver {merchant.bindingApproval.approvedBy} · evidence {merchant.bindingApproval.evidenceReference}</small> : null}{merchant.selfAccountReadError ? <small role="status">Self-account read: {label(merchant.selfAccountReadError.kind)}{merchant.selfAccountReadError.status ? ` · HTTP ${merchant.selfAccountReadError.status}` : ""}{merchant.selfAccountReadError.type ? ` · type ${label(merchant.selfAccountReadError.type)}` : ""}{merchant.selfAccountReadError.code ? ` · code ${label(merchant.selfAccountReadError.code)}` : ""}{merchant.selfAccountReadError.missingPermission ? ` · missing permission ${label(merchant.selfAccountReadError.missingPermission)}` : ""}</small> : null}<div>{merchant.requiredPermissions.map(permission=><small key={permission}>{permission}</small>)}<small>Checkout permission: {label(merchant.checkoutPermission)}.</small></div></article>)}</div><p className="muted">The configured account IDs are {label(result.accountIdsDistinct)} distinct. No account details, keys or customer data are shown. The fingerprint is a one-way digest used to bind approval to the installed key, not the key itself.</p></Surface>
    <Surface><span className="eyebrow">WEBHOOKS</span><p>Franchise and Products &amp; Services production signing secrets: {result.merchants.every(merchant=>merchant.webhookSecret === "configured") ? "configured in server environment" : "missing or invalid"}.</p><p>Products &amp; Services class webhook secret: {label(result.classWebhookSecret)}. All three webhook routes verify Stripe signatures in application code. The Stripe Dashboard endpoint-to-secret association is not readable through this diagnostic.</p><p className="muted">The self-account GET is read-only and does not use Connect. Checkout permissions are untested because verification requires an authorised Checkout request; no session is created by this diagnostic.</p></Surface>
    <Link className="member-hub-link" href={`/club/launch-readiness${q}`}>Back to launch readiness</Link><AppNav/>
  </AppShell>;
}
