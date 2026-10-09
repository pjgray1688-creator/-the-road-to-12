import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as runNotificationWorker } from "../app/api/internal/notification-worker/route";
import { renderNotification } from "../lib/notification-templates";
import { deliverNotification, senderAddress } from "../lib/notification-provider";
import { NOTIFICATION_MAX_ATTEMPTS, retryDelaySeconds, shouldRetry } from "../lib/notification-worker";

const sql = readFileSync("supabase/migrations/2026-11-21-notification-engine.sql", "utf8");
const provider = readFileSync("lib/notification-provider.ts", "utf8");
const route = readFileSync("app/api/internal/notification-worker/route.ts", "utf8");
const docs = readFileSync("docs/notification-delivery.md", "utf8");

test("the existing notification intent table becomes the durable provider-neutral outbox", () => {
  assert.match(sql, /alter table public\.club_member_notification_intents/);
  assert.match(sql, /target_email/);
  assert.match(sql, /sender_purpose/);
  assert.match(sql, /payload jsonb/);
  assert.match(sql, /claimed_until/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /grant execute on function public\.club_claim_notification_intents[^;]*to service_role/);
});

test("staff grants queue one safe invitation and revoke cancels it", () => {
  assert.match(sql, /club_queue_staff_invitation_notification/);
  assert.match(sql, /staff-invitation:/);
  assert.match(sql, /grantId/);
  assert.match(sql, /club_cancel_staff_invitation_notification/);
  assert.match(sql, /new\.status in \('revoked','expired'\)/);
  assert.match(sql, /club_resend_staff_invitation/);
  assert.match(sql, /staff\.invitation_resent/);
});

test("member activation is an authorised, idempotent intent and not identity proof", () => {
  assert.match(sql, /club_queue_member_activation_notification/);
  assert.match(sql, /members\.link_account/);
  assert.match(sql, /c\.user_id is not null/);
  assert.match(sql, /member-activation:/);
  assert.match(sql, /member\.activation_notification_queued/);
});

test("sender purposes and transactional templates stay bounded", () => {
  for (const sender of ["members", "billing", "staff"]) assert.match(provider, new RegExp(sender));
  for (const template of ["staff_invitation", "member_activation", "join_incomplete", "monthly_payment_failed", "yearly_renewal_1_month", "yearly_renewal_1_week", "yearly_renewal_final_days", "induction_reminder", "order_ready_for_collection", "maintenance_escalation", "schedule_update"]) assert.match(readFileSync("lib/notification-templates.ts", "utf8"), new RegExp(template));
  assert.doesNotMatch(provider, /NEXT_PUBLIC_R12|SMTP_PASSWORD\s*=/);
  assert.match(docs, /Supabase Auth remains responsible/);
});

test("billing and maintenance generation uses authoritative source state", () => {
  assert.match(sql, /a\.frequency='monthly'/);
  assert.match(sql, /monthly-payment-failed:/);
  assert.match(sql, /maintenance:/);
  assert.match(sql, /out_of_service or i\.priority in \('high','urgent'\)/);
  assert.match(sql, /status not in \('resolved','closed'\)/);
  assert.match(sql, /order_ready_for_collection/);
  assert.match(sql, /induction-reminder:/);
  assert.match(sql, /club_generate_notification_intents/);
});

test("worker availability is truthful and retries are bounded", async () => {
  assert.equal(shouldRetry(1, true), true);
  assert.equal(shouldRetry(NOTIFICATION_MAX_ATTEMPTS, true), false);
  assert.equal(shouldRetry(1, false), false);
  assert.equal(retryDelaySeconds(1), 60);
  assert.equal(retryDelaySeconds(4), 480);
  assert.match(route, /club_complete_notification_intent/);
  assert.match(route, /club_fail_notification_intent/);
  assert.match(route, /R12_NOTIFICATION_WORKER_SECRET/);
  assert.match(route, /stateUpdateFailures/);
  assert.match(route, /status: stateUpdateFailures \? 500 : 200/);
});

test("notification worker reports missing auth configuration without leaking secrets", async () => {
  const secret = process.env.R12_NOTIFICATION_WORKER_SECRET; const cron = process.env.CRON_SECRET;
  delete process.env.R12_NOTIFICATION_WORKER_SECRET; delete process.env.CRON_SECRET;
  try {
    const response = await runNotificationWorker(new NextRequest("https://app.test/api/internal/notification-worker"));
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /secret|token/i);
    process.env.R12_NOTIFICATION_WORKER_SECRET = "worker-secret-test";
    const unauthorized = await runNotificationWorker(new NextRequest("https://app.test/api/internal/notification-worker"));
    assert.equal(unauthorized.status, 401);
    assert.doesNotMatch(await unauthorized.text(), /worker-secret-test/);
  } finally {
    if (secret === undefined) delete process.env.R12_NOTIFICATION_WORKER_SECRET; else process.env.R12_NOTIFICATION_WORKER_SECRET = secret;
    if (cron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = cron;
  }
});

test("notification worker refuses to touch the outbox while no real transport is available", async () => {
  const worker = process.env.R12_NOTIFICATION_WORKER_SECRET;
  const cron = process.env.CRON_SECRET;
  process.env.R12_NOTIFICATION_WORKER_SECRET = "dedicated-test-secret";
  process.env.CRON_SECRET = "cron-test-secret";
  try {
    const response = await runNotificationWorker(new NextRequest("https://app.test/api/internal/notification-worker", { headers: { authorization: "Bearer cron-test-secret" } }));
    assert.equal(response.status, 503);
    assert.match(await response.text(), /no intents were claimed/i);
    assert.match(route, /club_generate_notification_intents/);
    assert.match(route, /notificationTransportAvailable/);
  } finally {
    if (worker === undefined) delete process.env.R12_NOTIFICATION_WORKER_SECRET; else process.env.R12_NOTIFICATION_WORKER_SECRET = worker;
    if (cron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = cron;
  }
});

test("SMTP configuration cannot falsely mark mail delivered while transport is unavailable", async () => {
  const provider = process.env.R12_EMAIL_PROVIDER;
  process.env.R12_EMAIL_PROVIDER = "smtp";
  try {
    const result = await deliverNotification({ id: "intent-1", recipientEmail: "member@example.test", sender: "members", subject: "Test", text: "Text", html: "<p>Text</p>" });
    assert.deepEqual(result, { ok: false, state: "unavailable", code: "smtp_adapter_not_configured", message: "SMTP delivery is not wired in this environment.", retryable: false });
    assert.equal(senderAddress("members"), "members@r12.live");
    assert.equal(senderAddress("staff"), "staff@r12.live");
    assert.equal(senderAddress("billing"), "madhouse.accounts@r12.live");
  } finally { if (provider === undefined) delete process.env.R12_EMAIL_PROVIDER; else process.env.R12_EMAIL_PROVIDER = provider; }
});

test("templates do not expose passwords or raw payment credentials", () => {
  const invitation = renderNotification({ templateKey: "staff_invitation", payload: { grantId: "grant-1", email: "staff@example.com", role: "trainer", organisationName: "Madhouse" } });
  assert.match(invitation.subject, /Madhouse/);
  assert.match(invitation.text, /staff@example.com/);
  assert.doesNotMatch(invitation.text, /password|card number|bank account/i);
  const billing = renderNotification({ templateKey: "monthly_payment_failed", payload: {} });
  assert.match(billing.text, /payment/i);
  assert.doesNotMatch(billing.text, /raw|secret|token/i);
});

test("schedule updates use the existing member delivery template with member-safe appointment facts", () => {
  const rendered = renderNotification({ templateKey: "schedule_update", payload: { eventType: "booked", kind: "PT session", title: "Personal training", startsAt: "Tuesday 18:00", location: "Madhouse Rotherham", internalNotes: "private" } });
  assert.equal(rendered.subject, "Your PT session has been booked");
  assert.match(rendered.text, /Tuesday 18:00/);
  assert.match(rendered.text, /Madhouse Rotherham/);
  assert.doesNotMatch(rendered.text, /private/);
});

test("notification links use the canonical app URL and never the landing domain", () => {
  const base = process.env.R12_APP_BASE_URL; const fallback = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.R12_APP_BASE_URL = "https://the-road-to-12.vercel.app"; delete process.env.NEXT_PUBLIC_SITE_URL;
  try {
    const invitation = renderNotification({ templateKey: "member_activation", payload: {} });
    assert.match(invitation.text, /https:\/\/the-road-to-12\.vercel\.app\/member-hub\/link/);
    assert.doesNotMatch(invitation.text, /https:\/\/r12\.live/);
  } finally {
    if (base === undefined) delete process.env.R12_APP_BASE_URL; else process.env.R12_APP_BASE_URL = base;
    if (fallback !== undefined) process.env.NEXT_PUBLIC_SITE_URL = fallback;
  }
});

test("Coach invitation copy is personal, private-client safe, and app-linked", () => {
  const invitation = renderNotification({ templateKey: "coach_relationship_invite", payload: {
    coachName: "Peter",
    relationshipType: "primary",
    invitePath: "/coach/join/token",
    expiresAt: "30 November 2026",
  } });
  assert.match(invitation.subject, /Peter has invited you to train with them on R12/);
  assert.match(invitation.text, /Peter has invited you to connect/);
  assert.match(invitation.text, /Accept the invitation/);
  assert.match(invitation.text, /30 November 2026/);
  assert.match(invitation.text, /\/coach\/join\/token/);
  assert.doesNotMatch(invitation.text, /Madhouse/);
});

test("notification state cannot become membership or access authority", () => {
  assert.doesNotMatch(sql, /update public\.club_memberships[\s\S]*notification/);
  assert.doesNotMatch(sql, /insert into public\.club_entitlement_grants[\s\S]*notification/);
  assert.match(sql, /Delivery is deliberately separate from membership\/access authority/);
});
