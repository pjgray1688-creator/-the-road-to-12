import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { completeGoCardlessRedirectFlow, createGoCardlessRedirectFlow } from "../lib/gocardless-join-provider";
import { goCardlessJoinEvent, stripeJoinEvent, stripeMembershipEvent } from "../lib/join-provider-events";
import { verifyGoCardlessSignature, verifyStripeSignature } from "../lib/join-provider-crypto";
import { createStripeCheckoutSession } from "../lib/stripe-join-provider";

const migration = readFileSync("supabase/migrations/2026-12-01-paid-member-provider-checkout.sql", "utf8");
const subscriptionMigration = readFileSync("supabase/migrations/2027-01-04-stripe-membership-subscriptions.sql", "utf8");
const actions = readFileSync("app/club/join/actions.ts", "utf8");
const joinForm = readFileSync("components/club-joining-form.tsx", "utf8");
const stripeWebhook = readFileSync("app/api/webhooks/stripe/route.ts", "utf8");
const goCardlessWebhook = readFileSync("app/api/webhooks/gocardless/route.ts", "utf8");

test("monthly Stripe Checkout separates the joining fee from the recurring subscription price", async () => {
  const original = process.env.STRIPE_SECRET_KEY;
  const originalMode = process.env.STRIPE_MEMBERSHIP_MODE;
  const originalAccount = process.env.STRIPE_FRANCHISE_ACCOUNT_ID;
  process.env.STRIPE_SECRET_KEY = "sk_test_not_real";
  process.env.STRIPE_MEMBERSHIP_MODE = "test";
  process.env.STRIPE_FRANCHISE_ACCOUNT_ID = "acct_franchise";
  let request: { url: string; init?: RequestInit } | undefined;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init };
    if (String(url).endsWith("/account")) return new Response(JSON.stringify({ id: "acct_franchise" }), { status: 200 });
    return new Response(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.test/session", mode: "subscription", status: "open", payment_status: "unpaid", amount_total: 4200, payment_intent: null, customer: null, subscription: null }), { status: 200 });
  }) as typeof fetch;
  try {
    await createStripeCheckoutSession({ requestId: "join-1", generation: 2, email: "member@example.com", productName: "Monthly", checkoutKind: "monthly_recurring", joiningFeeMinor: 1500, recurringAmountMinor: 2700, upfrontAmountMinor: 4200, currency: "GBP", successUrl: "https://app.test/success", cancelUrl: "https://app.test/cancel" }, fetcher);
    assert.equal(request?.url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(new Headers(request?.init?.headers).get("idempotency-key"), "r12-join-join-1-stripe-2");
    const body = request?.init?.body as URLSearchParams;
    assert.equal(body.get("mode"), "subscription");
    assert.equal(body.get("line_items[0][price_data][unit_amount]"), "2700");
    assert.equal(body.get("line_items[0][price_data][recurring][interval]"), "month");
    assert.equal(body.get("line_items[1][price_data][unit_amount]"), "1500");
    assert.equal(body.get("subscription_data[metadata][join_request_id]"), "join-1");
    assert.equal(body.get("metadata[join_request_id]"), "join-1");
    assert.equal(body.get("payment_method_types[0]"), "card");
  } finally {
    if (original === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = original;
    if (originalMode === undefined) delete process.env.STRIPE_MEMBERSHIP_MODE; else process.env.STRIPE_MEMBERSHIP_MODE = originalMode;
    if (originalAccount === undefined) delete process.env.STRIPE_FRANCHISE_ACCOUNT_ID; else process.env.STRIPE_FRANCHISE_ACCOUNT_ID = originalAccount;
  }
});

test("provider configuration fails closed before any external request", async () => {
  const stripe = process.env.STRIPE_SECRET_KEY; const stripeMode = process.env.STRIPE_MEMBERSHIP_MODE; const stripeAccount = process.env.STRIPE_FRANCHISE_ACCOUNT_ID; const gc = process.env.GOCARDLESS_ACCESS_TOKEN;
  delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_MEMBERSHIP_MODE; delete process.env.STRIPE_FRANCHISE_ACCOUNT_ID; delete process.env.GOCARDLESS_ACCESS_TOKEN;
  let calls = 0; const fetcher = (async () => { calls++; return new Response("{}"); }) as typeof fetch;
  try {
    await assert.rejects(createStripeCheckoutSession({ requestId: "x", generation: 1, email: "x@example.com", productName: "X", checkoutKind: "one_off", joiningFeeMinor: 0, recurringAmountMinor: 1, upfrontAmountMinor: 1, currency: "GBP", successUrl: "https://app.test", cancelUrl: "https://app.test" }, fetcher), /not configured/);
    await assert.rejects(createGoCardlessRedirectFlow({ requestId: "x", generation: 1, sessionToken: "token", description: "X", successUrl: "https://app.test" }, fetcher), /not configured/);
    assert.equal(calls, 0);
  } finally {
    if (stripe !== undefined) process.env.STRIPE_SECRET_KEY = stripe;
    if (stripeMode !== undefined) process.env.STRIPE_MEMBERSHIP_MODE = stripeMode;
    if (stripeAccount !== undefined) process.env.STRIPE_FRANCHISE_ACCOUNT_ID = stripeAccount;
    if (gc !== undefined) process.env.GOCARDLESS_ACCESS_TOKEN = gc;
  }
});

test("GoCardless hosted mandate creation and completion retain one joining attempt", async () => {
  const token = process.env.GOCARDLESS_ACCESS_TOKEN; const environment = process.env.GOCARDLESS_ENVIRONMENT;
  process.env.GOCARDLESS_ACCESS_TOKEN = "sandbox_not_real"; process.env.GOCARDLESS_ENVIRONMENT = "sandbox";
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    const complete = String(url).includes("actions/complete");
    return new Response(JSON.stringify({ redirect_flows: complete
      ? { id: "RE123", links: { mandate: "MD123", customer: "CU123", customer_bank_account: "BA123" } }
      : { id: "RE123", redirect_url: "https://pay-sandbox.gocardless.test/flow/RE123" } }), { status: 200 });
  }) as typeof fetch;
  try {
    await createGoCardlessRedirectFlow({ requestId: "join-1", generation: 3, sessionToken: "session-token", description: "Monthly", successUrl: "https://app.test/complete" }, fetcher);
    await completeGoCardlessRedirectFlow("RE123", "session-token", fetcher);
    assert.equal(new Headers(requests[0].init?.headers).get("idempotency-key"), "r12-join-join-1-mandate-3");
    assert.deepEqual(JSON.parse(String(requests[1].init?.body)), { data: { session_token: "session-token" } });
  } finally {
    if (token === undefined) delete process.env.GOCARDLESS_ACCESS_TOKEN; else process.env.GOCARDLESS_ACCESS_TOKEN = token;
    if (environment === undefined) delete process.env.GOCARDLESS_ENVIRONMENT; else process.env.GOCARDLESS_ENVIRONMENT = environment;
  }
});

test("signed webhook helpers reject tampering and stale Stripe requests", () => {
  const body = JSON.stringify({ events: [] }); const secret = "webhook-secret";
  const gc = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyGoCardlessSignature(body, gc, secret), true);
  assert.equal(verifyGoCardlessSignature(`${body}x`, gc, secret), false);
  const timestamp = 1_800_000_000;
  const stripe = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=${stripe}`, secret, timestamp), true);
  assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=${stripe}`, secret, timestamp + 301), false);
});

test("provider event mapping does not treat browser return or pending mandate as success", () => {
  const paid = stripeJoinEvent({ type: "checkout.session.completed", created: 1_800_000_000, data: { object: { id: "cs_1", amount_total: 4200, payment_status: "paid", metadata: { join_request_id: "join-1" } } } });
  assert.equal(paid?.eventType, "upfront_confirmed");
  assert.equal(stripeJoinEvent({ type: "checkout.session.completed", created: 1_800_000_000, data: { object: { id: "cs_1", payment_status: "unpaid", metadata: { join_request_id: "join-1" } } } }), null);
  assert.equal(stripeJoinEvent({ type: "payment_intent.payment_failed", created: 1_800_000_000, data: { object: { id: "pi_1", amount: 4200, metadata: { join_request_id: "join-1" } } } })?.eventType, "upfront_failed");
  assert.equal(goCardlessJoinEvent({ resource_type: "mandates", action: "submitted", created_at: "2027-01-01T00:00:00Z", links: { mandate: "MD1" } }), null);
  assert.equal(goCardlessJoinEvent({ resource_type: "mandates", action: "active", created_at: "2027-01-01T00:00:00Z", links: { mandate: "MD1" } })?.eventType, "mandate_confirmed");
  for (const action of ["failed", "cancelled", "expired", "replaced"]) assert.equal(goCardlessJoinEvent({ resource_type: "mandates", action, created_at: "2027-01-01T00:00:00Z", links: { mandate: "MD1" } })?.eventType, "mandate_failed");
});

test("Stripe subscription events retain payment, payer, subscription and billing-period identity", () => {
  const active = stripeMembershipEvent({ type: "customer.subscription.updated", created: 1_800_000_010, data: { object: { id: "sub_1", object: "subscription", status: "active", customer: "cus_1", current_period_end: 1_802_592_010, metadata: { join_request_id: "join-1" } } } });
  assert.equal(active?.eventType, "subscription_active");
  assert.equal(active?.subscriptionId, "sub_1");
  assert.equal(active?.customerId, "cus_1");
  const paid = stripeMembershipEvent({ type: "invoice.paid", created: 1_800_000_020, data: { object: { id: "in_1", object: "invoice", amount_paid: 4200, currency: "gbp", billing_reason: "subscription_create", customer: "cus_1", parent: { subscription_details: { subscription: "sub_1", metadata: { join_request_id: "join-1" } } } } } });
  assert.equal(paid?.eventType, "invoice_paid");
  assert.equal(paid?.amountMinor, 4200);
  assert.equal(paid?.currency, "GBP");
  assert.equal(paid?.requestId, "join-1");
  const incomplete = stripeMembershipEvent({ type: "customer.subscription.updated", created: 1, data: { object: { id: "sub_1", object: "subscription", status: "incomplete" } } });
  assert.equal(incomplete?.eventType, "subscription_incomplete");
  assert.equal(incomplete?.status, "incomplete");
  assert.equal(stripeMembershipEvent({ type: "customer.subscription.updated", created: 1, data: { object: { id: "sub_1", object: "subscription", status: "past_due" } } })?.eventType, "subscription_past_due");
  assert.equal(stripeMembershipEvent({ type: "charge.dispute.created", created: 1, data: { object: { id: "dp_1", charge: "ch_1", amount: 2700, status: "needs_response" } } })?.eventType, "dispute_opened");
});

test("database state machine is replay-safe, ordered, and activates exactly once after both trusted states", () => {
  assert.match(migration, /upfront_amount_minor/);
  assert.match(migration, /unique index.*stripe_checkout_session_id/i);
  assert.match(migration, /unique index.*gocardless_mandate_id/i);
  assert.match(migration, /on conflict\(organisation_id,provider_type,provider_event_key\) do nothing/);
  assert.match(migration, /superseded_provider_session/);
  assert.match(migration, /stripe_event_occurred_at.*e\.occurred_at>=r\.stripe_event_occurred_at/s);
  assert.match(migration, /gocardless_event_occurred_at.*e\.occurred_at>=r\.gocardless_event_occurred_at/s);
  assert.match(migration, /r\.upfront_payment_state='confirmed'.*r\.recurring_authority_state='confirmed'.*r\.membership_id is null/s);
  assert.match(migration, /assignment_idempotency_key='join:'\|\|r\.id/);
  assert.match(migration, /on conflict\(organisation_id,membership_id\) do update/);
  assert.match(migration, /status in \('active','completed','cancelled'\)/);
  assert.match(migration, /stripe_checkout_generation=stripe_checkout_generation\+1/);
  assert.match(migration, /gocardless_flow_generation=gocardless_flow_generation\+1/);
});

test("paid checkout leaves staff and Coach roles untouched and exposes truthful progress", () => {
  assert.doesNotMatch(migration, /update public\.club_members\s+set/i);
  assert.doesNotMatch(migration, /coach_permissions|coach_client/);
  assert.match(joinForm, /Pay securely with Stripe/);
  assert.match(joinForm, /Ongoing:.*monthly through Stripe/s);
  assert.match(joinForm, /Returning from Stripe does not activate access by itself/);
  assert.match(actions, /R12_APP_BASE_URL|siteUrl\(\)/);
  assert.doesNotMatch(actions, /r12\.live/);
  assert.match(stripeWebhook, /request\.text\(\)/);
  assert.match(stripeWebhook, /verifyStripeSignature/);
  assert.match(goCardlessWebhook, /verifyGoCardlessSignature/);
});

test("Stripe subscription state is durable, replay-safe and never activates from a redirect", () => {
  assert.match(subscriptionMigration, /unique\(provider_event_key\)/);
  assert.match(subscriptionMigration, /upfront_payment_state<>'confirmed'/);
  assert.match(subscriptionMigration, /recurring_authority_state<>'confirmed'/);
  assert.match(subscriptionMigration, /stripe_initial_charge_reversed/);
  assert.match(subscriptionMigration, /assignment_idempotency_key='join:'\|\|r\.id/);
  assert.match(subscriptionMigration, /values\(r\.organisation_id,m\.id,r\.user_id,r\.customer_id,'stripe','recurring_card'/);
  assert.match(subscriptionMigration, /payment_reversed/);
  assert.match(subscriptionMigration, /p_occurred_at>=o\.last_provider_event_at/);
  assert.match(subscriptionMigration, /Stripe customer does not match this join/);
  assert.match(subscriptionMigration, /p_status='incomplete' then 'pending'/);
  assert.match(subscriptionMigration, /p_period_start is null or coverage_start_at=p_period_start or next_due_at=p_period_start/);
  assert.match(subscriptionMigration, /if a\.next_due_at<=o\.next_due_at then/);
  assert.doesNotMatch(subscriptionMigration, /p_currency is null or upper\(p_currency\)/);
  assert.doesNotMatch(actions, /club_activate_verified_stripe_join/);
  assert.match(actions, /existing\.status === "complete".*includes\("failed"\)/s);
  assert.match(stripeWebhook, /club_record_stripe_membership_event/);
  assert.match(stripeWebhook, /STRIPE_MEMBERSHIP_MODE/);
});

test("paid checkout migration is in the reviewed deployment manifest", () => {
  assert.match(readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8"), /2026-12-01-paid-member-provider-checkout\.sql/);
  assert.match(readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8"), /2027-01-04-stripe-membership-subscriptions\.sql/);
});
