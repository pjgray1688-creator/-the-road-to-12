import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { completeGoCardlessRedirectFlow, createGoCardlessRedirectFlow } from "../lib/gocardless-join-provider";
import { goCardlessJoinEvent, stripeJoinEvent } from "../lib/join-provider-events";
import { verifyGoCardlessSignature, verifyStripeSignature } from "../lib/join-provider-crypto";
import { createStripeCheckoutSession } from "../lib/stripe-join-provider";

const migration = readFileSync("supabase/migrations/2026-12-01-paid-member-provider-checkout.sql", "utf8");
const actions = readFileSync("app/club/join/actions.ts", "utf8");
const joinForm = readFileSync("components/club-joining-form.tsx", "utf8");
const stripeWebhook = readFileSync("app/api/webhooks/stripe/route.ts", "utf8");
const goCardlessWebhook = readFileSync("app/api/webhooks/gocardless/route.ts", "utf8");

test("Stripe Checkout uses only the server-provided trusted amount and a stable attempt key", async () => {
  const original = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_test_not_real";
  let request: { url: string; init?: RequestInit } | undefined;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.test/session", status: "open", payment_status: "unpaid", amount_total: 4200, payment_intent: null }), { status: 200 });
  }) as typeof fetch;
  try {
    await createStripeCheckoutSession({ requestId: "join-1", generation: 2, email: "member@example.com", productName: "Monthly", amountMinor: 4200, currency: "GBP", successUrl: "https://app.test/success", cancelUrl: "https://app.test/cancel" }, fetcher);
    assert.equal(request?.url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(new Headers(request?.init?.headers).get("idempotency-key"), "r12-join-join-1-card-2");
    const body = request?.init?.body as URLSearchParams;
    assert.equal(body.get("line_items[0][price_data][unit_amount]"), "4200");
    assert.equal(body.get("metadata[join_request_id]"), "join-1");
    assert.equal(body.get("payment_method_types[0]"), "card");
  } finally { if (original === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = original; }
});

test("provider configuration fails closed before any external request", async () => {
  const stripe = process.env.STRIPE_SECRET_KEY; const gc = process.env.GOCARDLESS_ACCESS_TOKEN;
  delete process.env.STRIPE_SECRET_KEY; delete process.env.GOCARDLESS_ACCESS_TOKEN;
  let calls = 0; const fetcher = (async () => { calls++; return new Response("{}"); }) as typeof fetch;
  try {
    await assert.rejects(createStripeCheckoutSession({ requestId: "x", generation: 1, email: "x@example.com", productName: "X", amountMinor: 1, currency: "GBP", successUrl: "https://app.test", cancelUrl: "https://app.test" }, fetcher), /not configured/);
    await assert.rejects(createGoCardlessRedirectFlow({ requestId: "x", generation: 1, sessionToken: "token", description: "X", successUrl: "https://app.test" }, fetcher), /not configured/);
    assert.equal(calls, 0);
  } finally {
    if (stripe !== undefined) process.env.STRIPE_SECRET_KEY = stripe;
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
  assert.match(joinForm, /Pay securely by card/);
  assert.match(joinForm, /Set up Direct Debit/);
  assert.match(joinForm, /Returning from a provider does not activate access by itself/);
  assert.match(actions, /R12_APP_BASE_URL|siteUrl\(\)/);
  assert.doesNotMatch(actions, /r12\.live/);
  assert.match(stripeWebhook, /request\.text\(\)/);
  assert.match(stripeWebhook, /verifyStripeSignature/);
  assert.match(goCardlessWebhook, /verifyGoCardlessSignature/);
});

test("paid checkout migration is in the reviewed deployment manifest", () => {
  assert.match(readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8"), /2026-12-01-paid-member-provider-checkout\.sql/);
});
