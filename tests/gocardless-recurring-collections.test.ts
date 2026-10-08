import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as runWorkerRoute } from "../app/api/internal/membership-billing-worker/route";
import { createGoCardlessPayment, GoCardlessRequestError } from "../lib/gocardless-join-provider";
import { goCardlessMandateEvent, goCardlessPaymentEvent, runGoCardlessCollections } from "../lib/gocardless-recurring";
import { verifyGoCardlessSignature } from "../lib/join-provider-crypto";

const migration = readFileSync("supabase/migrations/2026-12-02-gocardless-recurring-collections.sql", "utf8");
const webhook = readFileSync("app/api/webhooks/gocardless/route.ts", "utf8");
const mandateReturn = readFileSync("app/api/club/join/gocardless/complete/route.ts", "utf8");
const memberProfile = readFileSync("app/club/members/[userId]/page.tsx", "utf8");

function withGoCardlessToken<T>(fn: () => Promise<T>) {
  const original = process.env.GOCARDLESS_ACCESS_TOKEN;
  process.env.GOCARDLESS_ACCESS_TOKEN = "not-a-real-token";
  return fn().finally(() => { if (original === undefined) delete process.env.GOCARDLESS_ACCESS_TOKEN; else process.env.GOCARDLESS_ACCESS_TOKEN = original; });
}

test("due collection sends the trusted claim amount with a stable provider idempotency key", async () => {
  const token = process.env.GOCARDLESS_ACCESS_TOKEN; const environment = process.env.GOCARDLESS_ENVIRONMENT;
  process.env.GOCARDLESS_ACCESS_TOKEN = "not-real"; process.env.GOCARDLESS_ENVIRONMENT = "sandbox";
  let request: { url: string; init?: RequestInit } | undefined;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ payments: { id: "PM123", amount: 4999, currency: "GBP", status: "pending_submission", charge_date: "2027-01-08", links: { mandate: "MD123" } } }), { status: 201 });
  }) as typeof fetch;
  try {
    await createGoCardlessPayment({ obligationId: "obligation-1", arrangementId: "arrangement-1", mandateId: "MD123", amountMinor: 4999, currency: "GBP", description: "January membership" }, fetcher);
    assert.equal(request?.url, "https://api-sandbox.gocardless.com/payments");
    assert.equal(new Headers(request?.init?.headers).get("idempotency-key"), "r12-membership-obligation-1");
    assert.deepEqual(JSON.parse(String(request?.init?.body)), { payments: { amount: 4999, currency: "GBP", description: "January membership", metadata: { obligation_id: "obligation-1", arrangement_id: "arrangement-1" }, links: { mandate: "MD123" } } });
  } finally { if (token === undefined) delete process.env.GOCARDLESS_ACCESS_TOKEN; else process.env.GOCARDLESS_ACCESS_TOKEN = token; if (environment === undefined) delete process.env.GOCARDLESS_ENVIRONMENT; else process.env.GOCARDLESS_ENVIRONMENT = environment; }
});

test("worker persists provider IDs and one provider failure does not stop another member", async () => withGoCardlessToken(async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rows = ["one", "two"].map(id => ({ id, arrangement_id: `arr-${id}`, membership_id: `member-${id}`, amount_minor: 4200, currency: "GBP", provider_subscription_reference: `MD-${id}`, period_key: "2027-01-01" }));
  const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return name === "club_claim_due_gocardless_collections" ? { data: rows, error: null } : { data: {}, error: null }; } };
  const result = await runGoCardlessCollections(client, async input => {
    if (input.obligationId === "one") throw new GoCardlessRequestError("validation rejected", 422);
    return { id: "PM-two", amount: 4200, currency: "GBP", status: "pending_submission", charge_date: "2027-01-05" };
  }, "worker-test");
  assert.deepEqual(result, { claimed: 2, created: 1, resumable: 0, failed: 1 });
  assert.equal(calls.some(call => call.name === "club_fail_gocardless_collection_attempt" && call.args.p_obligation_id === "one"), true);
  assert.equal(calls.some(call => call.name === "club_store_gocardless_collection" && call.args.p_provider_payment_id === "PM-two"), true);
}));

test("ambiguous provider failures remain resumable and reuse the same logical claim", async () => withGoCardlessToken(async () => {
  const calls: string[] = [];
  const client = { rpc: async (name: string) => { calls.push(name); return name === "club_claim_due_gocardless_collections" ? { data: [{ id: "same-obligation", arrangement_id: "a", membership_id: "m", amount_minor: 1000, currency: "GBP", provider_subscription_reference: "MD1", period_key: "2027-01" }], error: null } : { data: {}, error: null }; } };
  const result = await runGoCardlessCollections(client, async () => { throw new GoCardlessRequestError("timeout", 0); }, "worker-test");
  assert.equal(result.resumable, 1);
  assert.equal(calls.includes("club_fail_gocardless_collection_attempt"), false);
  assert.match(migration, /collection_claimed_at<now\(\)-make_interval/);
  assert.match(readFileSync("supabase/migrations/2026-09-28-club-membership-billing-dunning.sql", "utf8"), /unique \(arrangement_id, period_key\)/i);
}));

test("provider configuration and worker endpoint fail closed", async () => {
  const token = process.env.GOCARDLESS_ACCESS_TOKEN; const worker = process.env.R12_BILLING_WORKER_SECRET; const cron = process.env.CRON_SECRET;
  delete process.env.GOCARDLESS_ACCESS_TOKEN; delete process.env.R12_BILLING_WORKER_SECRET; delete process.env.CRON_SECRET;
  try {
    const client = { rpc: async () => { throw new Error("must not claim"); } };
    await assert.rejects(runGoCardlessCollections(client), /configuration is missing/);
    const response = await runWorkerRoute(new NextRequest("https://app.test/api/internal/membership-billing-worker"));
    assert.equal(response.status, 401);
  } finally { if (token !== undefined) process.env.GOCARDLESS_ACCESS_TOKEN = token; if (worker !== undefined) process.env.R12_BILLING_WORKER_SECRET = worker; if (cron !== undefined) process.env.CRON_SECRET = cron; }
});

test("signed payment webhooks map lifecycle and ignore unsupported events", () => {
  const body = JSON.stringify({ events: [] }); const secret = "secret";
  assert.equal(verifyGoCardlessSignature(body, createHmac("sha256", secret).update(body).digest("hex"), secret), true);
  for (const action of ["created", "submitted", "confirmed", "paid_out", "failed", "cancelled", "charged_back", "retry_scheduled"]) {
    assert.equal(goCardlessPaymentEvent({ id: "EV1", resource_type: "payments", action, created_at: "2027-01-01T00:00:00Z", links: { payment: "PM1" } })?.status, action);
  }
  assert.equal(goCardlessPaymentEvent({ id: "EV1", resource_type: "payments", action: "resubmission_requested", created_at: "2027-01-01T00:00:00Z", links: { payment: "PM1" } })?.status, "retry_scheduled");
  assert.equal(goCardlessPaymentEvent({ id: "EV1", resource_type: "payments", action: "customer_approval_granted", created_at: "2027-01-01T00:00:00Z", links: { payment: "PM1" } })?.status, "submitted");
  assert.equal(goCardlessMandateEvent({ id: "EV2", resource_type: "mandates", action: "cancelled", created_at: "2027-01-01T00:00:00Z", links: { mandate: "MD1" } })?.status, "cancelled");
});

test("database lifecycle is duplicate-safe, ordered, success-once, and calendar-month based", () => {
  assert.match(migration, /club_billing_obligation_gc_payment_uq/);
  assert.match(migration, /club_billing_arrangement_gc_mandate_uq/);
  assert.match(migration, /for update of ob skip locked/);
  assert.match(migration, /provider_payment_reference is null/);
  assert.match(migration, /if not found then return jsonb_build_object\('duplicate',true/);
  assert.match(migration, /p_occurred_at<o\.last_provider_event_at/);
  assert.match(migration, /was_settled:=o\.collection_settled_at is not null/);
  assert.match(migration, /if not was_settled then/);
  assert.match(migration, /club_next_membership_billing_due/);
  assert.match(migration, /state='grace'/);
  assert.match(migration, /provider_retry_expected/);
  assert.match(migration, /if was_settled then.*coverage_paid_through_at=restored_paid_through/s);
  assert.match(migration, /provider_authority_state='active'/);
  assert.match(migration, /p_provider_status<>'active'.*state='cancelled'/s);
  assert.match(migration, /club_prepare_recurring_mandate_attempt/);
  assert.match(migration, /club_membership_billing_obligations set provider_subscription_reference=p_mandate_id/);
  assert.doesNotMatch(migration, /update public\.club_members\s+set/i);
  assert.doesNotMatch(migration, /coach_permissions|coach_client/);
});

test("webhook and staff surfaces use recurring reconciliation state", () => {
  assert.match(webhook, /club_reconcile_gocardless_collection_event/);
  assert.match(webhook, /club_reconcile_gocardless_mandate_event/);
  assert.match(webhook, /verifyGoCardlessSignature/);
  assert.ok(webhook.indexOf("club_record_join_provider_event") < webhook.indexOf("club_reconcile_gocardless_mandate_event"), "join activation must create the arrangement before mandate reconciliation");
  assert.match(mandateReturn, /club_reconcile_gocardless_mandate_event/);
  assert.match(memberProfile, /provider_status/);
  assert.match(memberProfile, /action_required_reason/);
  assert.match(migration, /provider_payment_reference.*club_list_customer_billing/s);
  assert.match(readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8"), /2026-12-02-gocardless-recurring-collections\.sql/);
});
