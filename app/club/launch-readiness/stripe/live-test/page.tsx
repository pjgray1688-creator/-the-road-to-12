import Link from "next/link";
import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClubSectionNav } from "@/components/club-shell";
import { AppShell, EmptyState, PageHeader, Surface } from "@/components/ui";
import { hasPlayReviewerEntitlement } from "@/lib/play-reviewer";
import { resolveClubOrganisationContext } from "@/lib/club-server-context";
import { adminSupabase } from "@/lib/supabase-admin";
import { serverSupabase } from "@/lib/supabase-server";
import { MADHOUSE_ORGANISATION_ID, stripeLiveTestMerchants } from "@/lib/stripe-live-test";
import { inspectStripeLiveTestApproval, readStripeMerchantConfig, type StripeMerchantEntity } from "@/lib/stripe-merchant";
import { startFranchiseStripeLiveTestAction, startProductsServicesStripeLiveTestAction } from "../live-test-actions";

export const dynamic = "force-dynamic";

type Run = {
  id?: string;
  merchant_entity?: StripeMerchantEntity;
  stripe_account_id?: string;
  checkout_state?: string;
  payment_state?: string;
  amount_minor?: number;
  currency?: string;
  session_created?: boolean;
  checkout_session_id?: string | null;
  payment_intent_id?: string | null;
  webhook_received_at?: string | null;
  last_provider_event_id?: string | null;
  failure_class?: string | null;
};

function merchantCard(entity: StripeMerchantEntity, run: Run | null, ledgerError: boolean, webhookSecretsDistinct: boolean, env: NodeJS.ProcessEnv) {
  const merchant = stripeLiveTestMerchants[entity];
  const config = (() => { try { return readStripeMerchantConfig(entity, env); } catch { return null; } })();
  const configReady = config?.mode === "live";
  const approval = inspectStripeLiveTestApproval(entity, env);
  const blockedByNormalGate = env.STRIPE_FRANCHISE_LIVE_ENABLED === "true" || env.STRIPE_PRODUCTS_SERVICES_LIVE_ENABLED === "true";
  const passed = Boolean(configReady && approval.status === "verified" && !blockedByNormalGate && run?.stripe_account_id === config?.accountId
    && run?.checkout_state === "complete" && run.payment_state === "paid" && run.session_created
    && run.checkout_session_id && run.payment_intent_id && run.webhook_received_at && run.amount_minor === 100 && run.currency === "GBP");
  return <Surface key={entity}>
    <span className="eyebrow">ONE-TIME LIVE ROUTING TEST · £1.00 GBP</span>
    <h2>{merchant.title}</h2>
    <p>Hosted Checkout is routed to the Stripe account currently labelled <strong>{merchant.dashboardName}</strong>. The company-name transition is still pending; this test does not certify a legal entity.</p>
    <p>Configuration: {configReady ? "live key and webhook variables present" : "missing or invalid"} · Signed test approval: {approval.status} · Normal live checkout: {blockedByNormalGate ? "blocked because a public gate is enabled" : "disabled"}</p>
    {run ? <div className="club-list" aria-label={`${merchant.title} test results`}>
      <div className="club-detail-row"><strong>Result</strong><b>{passed ? "PASS · payment reconciled" : run.payment_state === "failed" && run.checkout_state === "created" ? "PAYMENT DECLINED · original hosted session remains the only allowed session" : run.failure_class ? "FAIL / ATTEMPT STOPPED" : "INCOMPLETE · awaiting verified webhook"}</b></div>
      <div className="club-detail-row"><strong>Checkout session</strong><span>{run.session_created ? `${run.checkout_state === "complete" ? "completed" : "created"} · ${run.checkout_session_id ?? "ID unavailable"}` : run.checkout_state ?? "not created"}</span></div>
      <div className="club-detail-row"><strong>Payment</strong><span>{run.payment_state ?? "unpaid"} · {run.amount_minor === 100 ? "£1.00 GBP" : "amount mismatch"}{run.payment_intent_id ? ` · ${run.payment_intent_id}` : ""}</span></div>
      <div className="club-detail-row"><strong>Signed webhook</strong><span>{run.webhook_received_at ? `received and reconciled ${new Date(run.webhook_received_at).toLocaleString("en-GB", { timeZone: "Europe/London" })} · ${run.last_provider_event_id ?? "event recorded"}` : "not yet received/reconciled"}</span></div>
      {run.failure_class ? <div className="club-detail-row"><strong>Failure classification</strong><code>{run.failure_class}</code><small>Do not create another Checkout. If a card was declined while the hosted page remains open, only the same Checkout session may be completed.</small></div> : null}
    </div> : <p>No session has been created for this merchant.</p>}
    {run ? <p className="muted">This merchant’s single attempt is permanently reserved. No automatic retry, replacement Checkout or second payment is available.</p>
      : ledgerError || !configReady || approval.status !== "verified" || blockedByNormalGate || !webhookSecretsDistinct
        ? <p role="status">{ledgerError ? "Blocked: the controlled-test migration or results RPC is unavailable." : !webhookSecretsDistinct ? "Blocked: all three endpoint signing-secret variables must be configured and distinct." : "Blocked until live configuration and signed operator approval pass, and both ordinary live Checkout gates remain disabled."}</p>
        : <form action={entity === "madhouse_franchise" ? startFranchiseStripeLiveTestAction : startProductsServicesStripeLiveTestAction}>
          <button className="primary" type="submit">Authorised admin: create £1 {merchant.title} hosted Checkout</button>
          <p className="muted">This action creates one card-only hosted session. The account owner should complete payment personally with their own card. R12 never receives card details and does not create a customer purchase or entitlement.</p>
        </form>}
  </Surface>;
}

export default async function StripeLiveTestPage({ searchParams }: { searchParams?: Promise<{ org?: string; result?: string }> }) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/account?mode=signIn&next=%2Fclub%2Flaunch-readiness%2Fstripe%2Flive-test");
  if (hasPlayReviewerEntitlement(user)) return <AppShell className="module-page club-page"><PageHeader title="Stripe live test"/><EmptyState title="Owner access required">Controlled payment tests are not available to reviewers.</EmptyState><AppNav/></AppShell>;
  const context = await resolveClubOrganisationContext(client, user.id, (await searchParams)?.org ?? MADHOUSE_ORGANISATION_ID);
  if (!context || !["owner", "gym_admin"].includes(context.role) || context.organisation.id !== MADHOUSE_ORGANISATION_ID) return <AppShell className="module-page club-page"><PageHeader title="Stripe live test"/><EmptyState title="Admin access required">Only Madhouse owners and authorised Manager/Operations administrators can use controlled live payment testing.</EmptyState><AppNav/></AppShell>;
  const entities: StripeMerchantEntity[] = ["madhouse_franchise", "madhouse_products_services"];
  const runResults = await Promise.all(entities.map(entity => client.rpc("club_get_my_stripe_live_test_run", { p_merchant_entity: entity })));
  const runs = runResults.map(({ data, error }) => !error && data && typeof data === "object" ? data as Run : null);
  const classWebhookConfigured = Boolean(process.env.STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET?.startsWith("whsec_"));
  const webhookSecretsDistinct = (() => {
    try {
      const secrets = [readStripeMerchantConfig("madhouse_franchise").webhookSecret, readStripeMerchantConfig("madhouse_products_services").webhookSecret, process.env.STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET?.trim() ?? ""];
      return secrets.every(secret => secret.startsWith("whsec_")) && new Set(secrets).size === 3;
    } catch { return false; }
  })();
  const origins = `?org=${encodeURIComponent(context.organisation.id)}`;
  return <AppShell className="module-page club-page">
    <PageHeader eyebrow="R12 CLUB · AUTHORISED ADMIN ONLY" title="Controlled Stripe live tests" description="Two operator-initiated, one-time £1 hosted payments. This screen is isolated from memberships, orders, classes, subscriptions and fulfilment."/>
    <ClubSectionNav organisation={context.organisation} role={context.role} contexts={context.availableContexts}/>
    <Surface><strong>Strict test budget: £2.00 maximum across both Stripe merchants.</strong><p>R12 will not initiate either payment automatically. Only you can open and complete a hosted Checkout. No normal live payment gate is enabled by this workflow. Never treat a return from Stripe as confirmation; only the correctly signed merchant webhook can pass a test.</p><div className="club-list"><div className="club-detail-row"><span><strong>Franchise merchant endpoint</strong><small>/api/webhooks/stripe · STRIPE_FRANCHISE_WEBHOOK_SECRET</small></span><b>{(() => { try { return readStripeMerchantConfig("madhouse_franchise").webhookSecret.startsWith("whsec_") ? "Configured · delivery not observed" : "Missing"; } catch { return "Missing"; } })()}</b></div><div className="club-detail-row"><span><strong>Products &amp; Services endpoint</strong><small>/api/webhooks/stripe/products-services · STRIPE_PRODUCTS_SERVICES_WEBHOOK_SECRET</small></span><b>{(() => { try { return readStripeMerchantConfig("madhouse_products_services").webhookSecret.startsWith("whsec_") ? "Configured · delivery not observed" : "Missing"; } catch { return "Missing"; } })()}</b></div><div className="club-detail-row"><span><strong>Products &amp; Services class endpoint</strong><small>/api/webhooks/stripe/classes · STRIPE_PRODUCTS_SERVICES_CLASS_WEBHOOK_SECRET · controlled test events are ignored here</small></span><b>{classWebhookConfigured ? "Configured · test delivery not expected" : "Missing"}</b></div></div><p>Three signing-secret variables are {webhookSecretsDistinct ? "present and distinct" : "missing, invalid, or not distinct"}; these are configuration checks only.</p><p className="muted">Environment presence does not prove the Stripe Dashboard endpoint uses the matching signing secret. Successful per-merchant test reconciliation below is the evidence of endpoint delivery and merchant routing. The class route remains separate and must not reconcile this test.</p></Surface>
    {entities.map((entity, index) => merchantCard(entity, runs[index], Boolean(runResults[index].error), webhookSecretsDistinct, process.env))}
    {((await searchParams)?.result === "returned" || (await searchParams)?.result === "cancelled") ? <Surface><p role="status">Checkout returned to R12. The redirect is not evidence of payment. Refresh this page after the merchant webhook reconciles.</p></Surface> : null}
    <Link className="member-hub-link" href={`/club/launch-readiness/stripe${origins}`}>Back to Stripe readiness</Link><AppNav/>
  </AppShell>;
}
