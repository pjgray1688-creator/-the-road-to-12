import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as runNotificationWorker } from "../app/api/internal/notification-worker/route";
import { renderNotification } from "../lib/notification-templates";
import { deliverNotification, notificationTransportAvailable, senderAddress } from "../lib/notification-provider";
import { inspectSmtpConfiguration } from "../lib/smtp-config";
import { EventEmitter } from "node:events";
import { sendSmtpMessage } from "../lib/smtp-transport";
import { NOTIFICATION_MAX_ATTEMPTS, notificationWorkerLimits, retryDelaySeconds, shouldRetry } from "../lib/notification-worker";

const sql = readFileSync("supabase/migrations/2026-11-21-notification-engine.sql", "utf8");
const provider = readFileSync("lib/notification-provider.ts", "utf8");
const route = readFileSync("app/api/internal/notification-worker/route.ts", "utf8");
const docs = readFileSync("docs/notification-delivery.md", "utf8");
const launchSupportSql = readFileSync("supabase/migrations/2026-12-24-staff-owner-transfer-and-member-activation-queue.sql", "utf8");
const billingJoinSql = readFileSync("supabase/migrations/2026-11-19-madhouse-billing-and-tutorials.sql", "utf8");
const notificationGeneratorFixSql = readFileSync("supabase/migrations/2026-12-25-notification-generator-null-safe-auth-lookup.sql", "utf8");
const notificationRecordFixSql = readFileSync("supabase/migrations/2026-12-26-notification-generator-record-alias-safety.sql", "utf8");
const notificationGenerationFixtureSql = readFileSync("tests/sql/notification-generation-launch.sql", "utf8");
const notificationOutboxFixtureSql = readFileSync("tests/sql/notification-outbox-launch.sql", "utf8");
const postgresWorkflow = readFileSync(".github/workflows/validate-migrations-postgres.yml", "utf8");

test("PostgreSQL CI auth.role reads the session JWT role claims rather than assuming service_role", () => {
  assert.match(postgresWorkflow, /create function auth\.role\(\) returns text language sql stable/);
  assert.match(postgresWorkflow, /current_setting\('request\.jwt\.claim\.role',true\)/);
  assert.match(postgresWorkflow, /current_setting\('request\.jwt\.claims',true\).*->>'role'/s);
  assert.match(postgresWorkflow, /grant execute on function auth\.uid\(\),auth\.jwt\(\),auth\.role\(\) to anon,authenticated,service_role/);
  assert.match(notificationOutboxFixtureSql, /set_config\('request\.jwt\.claim\.role','authenticated'/);
  assert.match(notificationOutboxFixtureSql, /set_config\('request\.jwt\.claim\.role','anon'/);
  assert.match(notificationOutboxFixtureSql, /set_config\('request\.jwt\.claim\.role','service_role'/);
});

test("notification SQL fixture verifies only service_role can execute worker claims", () => {
  assert.match(notificationOutboxFixtureSql, /Ordinary authenticated user claimed notification work/);
  assert.match(notificationOutboxFixtureSql, /Anonymous user claimed notification work/);
  assert.match(notificationOutboxFixtureSql, /service role claim/);
  assert.match(launchSupportSql, /revoke all on function public\.club_claim_notification_intents_for_worker\(integer,text,boolean\) from public,anon,authenticated/);
  assert.match(launchSupportSql, /grant execute on function public\.club_claim_notification_intents_for_worker\(integer,text,boolean\) to service_role/);
});

test("notification outbox fixture keeps direct table inspection under the disposable database owner", () => {
  const roleSegments = notificationOutboxFixtureSql.split(/(?=^(?:set local role|reset role);)/m);
  for (const segment of roleSegments) {
    if (!/^set local role (?:anon|authenticated|service_role);/.test(segment)) continue;
    for (const statement of segment.split(";")) {
      assert.doesNotMatch(statement, /\b(?:select|insert\s+into|update|delete\s+from)\b[^;]*\bpublic\.club_member_notification_intents\b/i);
    }
  }
  for (const id of ["30000000-0000-4000-8000-000000000011", "30000000-0000-4000-8000-000000000012"]) {
    const queryIndex = notificationOutboxFixtureSql.lastIndexOf(`state from public.club_member_notification_intents where id='${id}'`);
    assert.ok(queryIndex >= 0, `privileged state assertion exists for ${id}`);
    const lastRoleSwitch = Math.max(
      notificationOutboxFixtureSql.lastIndexOf("set local role", queryIndex),
      notificationOutboxFixtureSql.lastIndexOf("reset role", queryIndex),
    );
    assert.ok(notificationOutboxFixtureSql.lastIndexOf("reset role", queryIndex) === lastRoleSwitch, `state assertion for ${id} follows RESET ROLE`);
    const claimClearIndex = notificationOutboxFixtureSql.lastIndexOf("set_config('request.jwt.claim.role','',true)", queryIndex);
    assert.ok(claimClearIndex > notificationOutboxFixtureSql.lastIndexOf("set local role", queryIndex), `state assertion for ${id} follows clearing the worker JWT claim`);
  }
  assert.equal((notificationOutboxFixtureSql.match(/reset role;\s*select set_config\('request\.jwt\.claim\.sub','',true\);\s*select set_config\('request\.jwt\.claim\.role','',true\);\s*select set_config\('request\.jwt\.claims','\{\}',true\);/g) ?? []).length, 5);
  assert.match(notificationOutboxFixtureSql, /ci-notification-worker-retry[\s\S]*?ci-notification-worker-release[\s\S]*?member activation claimable/);
  assert.match(notificationOutboxFixtureSql, /Unique activation member/);
  assert.match(notificationOutboxFixtureSql, /related_type,related_id[\s\S]*?member_activation/);
  assert.match(notificationOutboxFixtureSql, /Default claim should process staff mail but hold member activation/);
  assert.match(notificationOutboxFixtureSql, /Explicit release did not make the member activation claimable/);
  assert.equal((notificationOutboxFixtureSql.match(/set local role service_role;\s*select set_config\('request\.jwt\.claim\.role','service_role',true\);\s*do \$\$/g) ?? []).length, 3, "every service-only RPC block must set the actual Supabase JWT claim, not only SET ROLE");
});

test("notification generation fixture models a valid unique member recipient before asserting generator integrity", () => {
  assert.match(notificationGenerationFixtureSql, /Unique activation member/);
  assert.match(notificationGenerationFixtureSql, /member_activation'[\s\S]*?'customer','30000000-0000-4000-8000-000000000043'/);
  assert.match(notificationGenerationFixtureSql, /target_email='member@example\.test' and template_key='member_activation'/);
  assert.match(route, /p_include_member_activation: process\.env\.R12_MEMBER_ACTIVATION_EMAILS_ENABLED === "true"/);
  assert.match(launchSupportSql, /p_include_member_activation or template_key<>'member_activation'/);
});

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

test("notification generator handles a missing optional Auth email without reading an unassigned record", () => {
  const generatorStart = notificationGeneratorFixSql.indexOf("create or replace function public.club_generate_notification_intents()");
  const generatorEnd = notificationGeneratorFixSql.indexOf("revoke all on function public.club_generate_notification_intents()");
  assert.ok(generatorStart >= 0 && generatorEnd > generatorStart);
  const generator = notificationGeneratorFixSql.slice(generatorStart, generatorEnd);
  assert.match(generator, /v_email text/);
  assert.match(generator, /select au\.email into v_email from auth\.users au where au\.id=o\.user_id/);
  assert.match(generator, /if v_email is not null then[\s\S]*?values\(o\.organisation_id,o\.user_id,v_email/);
  assert.doesNotMatch(generator, /select\s+(?:au\.)?email\s+into\s+u\b/i);
  assert.match(generator, /for manager in select m\.user_id,au\.email/);
  assert.match(notificationGenerationFixtureSql, /new-staff@example\.test/);
  assert.match(notificationGenerationFixtureSql, /existing-staff@example\.test/);
  assert.match(notificationGenerationFixtureSql, /member@example\.test/);
  assert.match(notificationGenerationFixtureSql, /perform public\.club_generate_notification_intents\(\);\s*perform public\.club_generate_notification_intents\(\);/);
  assert.match(notificationGenerationFixtureSql, /Repeated generation created duplicate intents/);
});

test("notification generation fixture separates worker roles from privileged setup and state inspection", () => {
  const protectedRelations = [
    "auth\\.users",
    "public\\.club_member_notification_intents",
    "public\\.club_membership_billing_obligations",
    "public\\.club_membership_billing_arrangements",
    "public\\.club_membership_holders",
    "public\\.club_memberships",
    "public\\.club_products",
    "public\\.club_organisations",
  ];
  for (const relation of protectedRelations) {
    const expression = new RegExp(`\\b${relation}\\b`, "g");
    for (const match of notificationGenerationFixtureSql.matchAll(expression)) {
      const setRole = notificationGenerationFixtureSql.lastIndexOf("set local role", match.index);
      const resetRole = notificationGenerationFixtureSql.lastIndexOf("reset role", match.index);
      assert.ok(resetRole < 0 || resetRole > setRole, `direct ${relation.replaceAll("\\.", ".")} access uses the disposable owner`);
    }
  }
  for (const role of ["authenticated", "anon"]) {
    assert.match(notificationGenerationFixtureSql, new RegExp(`set local role ${role};[\\s\\S]*?request\\.jwt\\.claim\\.role','${role}'[\\s\\S]*?perform public\\.club_generate_notification_intents\\(\\);[\\s\\S]*?exception when insufficient_privilege[\\s\\S]*?reset role;`));
  }
  assert.match(notificationGenerationFixtureSql, /set local role service_role;\s*select set_config\('request\.jwt\.claim\.role','service_role',true\);\s*do \$\$ begin[\s\S]*?auth\.role\(\)<>'service_role'[\s\S]*?perform public\.club_generate_notification_intents\(\);[\s\S]*?end \$\$;\s*reset role;/);
  assert.match(notificationGenerationFixtureSql, /reset role;\s*select set_config\('request\.jwt\.claim\.sub','',true\);\s*select set_config\('request\.jwt\.claim\.role','',true\);\s*select set_config\('request\.jwt\.claims','\{\}',true\);\s*\n\s*do \$\$/);
  assert.match(notificationGenerationFixtureSql, /Missing optional Auth lookup unexpectedly returned an email/);
  assert.match(notificationGenerationFixtureSql, /eligible member activation recipient was changed during generation/);
  assert.match(notificationGenerationFixtureSql, /Monthly dunning generation was not idempotent/);
  assert.match(notificationGenerationFixtureSql, /insert into public\.club_membership_holders\(organisation_id,membership_id,user_id\)\s*values\('30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000052','30000000-0000-4000-8000-000000000021'\)/);
  assert.equal((notificationGenerationFixtureSql.match(/reset role;\s*select set_config\('request\.jwt\.claim\.sub','',true\);\s*select set_config\('request\.jwt\.claim\.role','',true\);\s*select set_config\('request\.jwt\.claims','\{\}',true\);/g) ?? []).length, 4);
});

test("notification generator uses distinct loop records and SQL aliases so empty loops are safe", () => {
  const start = notificationRecordFixSql.indexOf("create or replace function public.club_generate_notification_intents()");
  const end = notificationRecordFixSql.indexOf("revoke all on function public.club_generate_notification_intents()");
  assert.ok(start >= 0 && end > start);
  const generator = notificationRecordFixSql.slice(start, end);
  for (const name of ["billing_row", "booking_row", "event_row", "issue_row", "manager_row"]) assert.match(generator, new RegExp(`\\b${name}\\s+record`));
  assert.match(generator, /for billing_row in[\s\S]*?loop[\s\S]*?billing_row\.organisation_id[\s\S]*?end loop/);
  assert.match(generator, /current_obligation\.id=intent\.related_id/);
  assert.match(generator, /current_issue\.id=intent\.related_id/);
  assert.doesNotMatch(generator, /\bo\.(?:id|user_id|organisation_id|arrangement_id)\b/);
  assert.doesNotMatch(generator, /\bi\.(?:id|organisation_id|priority|status)\b/);
  assert.match(notificationGenerationFixtureSql, /zero-row[\s\S]*billing loop/);
  assert.match(notificationGenerationFixtureSql, /Zero-obligation generation fixture/);
  assert.match(notificationGenerationFixtureSql, /Monthly dunning generation was not idempotent/);
  assert.match(notificationGenerationFixtureSql, /billing intent whose source obligation is missing/);
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

test("worker throughput is configurable but has bounded batches, runtime and total work", () => {
  assert.deepEqual(notificationWorkerLimits({} as NodeJS.ProcessEnv), {
    batchSize: 100, maxBatches: 10, runtimeBudgetMs: 240_000, sendConcurrency: 10,
    messageTimeoutMs: 20_000, maxMessagesPerRun: 1000,
  });
  assert.equal(notificationWorkerLimits({ NODE_ENV: "test", R12_NOTIFICATION_BATCH_SIZE: "250", R12_NOTIFICATION_MAX_BATCHES_PER_RUN: "99" } as NodeJS.ProcessEnv).batchSize, 100);
  const reduced = notificationWorkerLimits({ NODE_ENV: "test", R12_NOTIFICATION_BATCH_SIZE: "40", R12_NOTIFICATION_MAX_BATCHES_PER_RUN: "3" } as NodeJS.ProcessEnv);
  assert.equal(reduced.maxMessagesPerRun, 120);
  assert.equal(reduced.maxBatches, 3);
  assert.match(route, /runtimeSafeBatchSize/);
  assert.match(route, /limits\.sendConcurrency/);
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

test("notification worker failure logs identify the database/delivery operation without logging error details", () => {
  assert.match(route, /let operation = "database_configuration"/);
  assert.match(route, /operation = "generate_intents"/);
  assert.match(route, /operation = "claim_intents"/);
  assert.match(route, /operation = "deliver_or_update_state"/);
  assert.match(route, /\{ code: typeof source\.code === "string" \? source\.code : "UNKNOWN", operation \}/);
  assert.doesNotMatch(route, /console\.error\("\[notifications\] worker failed"[^\n]*message/);
});

test("the repository's explicit SQLSTATE 55000 guards are outside the notification worker RPC path", () => {
  const memberResendStart = launchSupportSql.indexOf("create or replace function public.club_resend_member_activation_notification");
  const workerClaimStart = launchSupportSql.indexOf("create or replace function public.club_claim_notification_intents_for_worker");
  const ownerTransferStart = launchSupportSql.indexOf("create or replace function public.club_transfer_organisation_owner");
  assert.ok(memberResendStart >= 0 && workerClaimStart > memberResendStart && ownerTransferStart > workerClaimStart);
  assert.match(launchSupportSql.slice(memberResendStart, workerClaimStart), /Activation email is already being processed or was cancelled' using errcode='55000'/);
  assert.doesNotMatch(launchSupportSql.slice(workerClaimStart, ownerTransferStart), /55000/);
  assert.match(billingJoinSql, /Monthly joining fee is not configured' using errcode='55000'/);
  assert.match(route, /club_generate_notification_intents/);
  assert.match(route, /club_claim_notification_intents_for_worker/);
  assert.match(route, /club_complete_notification_intent/);
  assert.match(route, /club_fail_notification_intent/);
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

test("SMTP configuration fails closed when transport settings are incomplete", async () => {
  const keys = ["R12_EMAIL_PROVIDER", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USERNAME", "SMTP_PASSWORD"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  process.env.R12_EMAIL_PROVIDER = "smtp";
  try {
    const result = await deliverNotification({ id: "intent-1", recipientEmail: "member@example.test", sender: "members", subject: "Test", text: "Text", html: "<p>Text</p>" });
    assert.deepEqual(result, { ok: false, state: "unavailable", code: "smtp_configuration_incomplete", message: "SMTP delivery is not configured completely.", retryable: false });
    assert.equal(notificationTransportAvailable(), false);
    assert.equal(inspectSmtpConfiguration().state, "missing");
    assert.equal(senderAddress("members"), "members@r12.live");
    assert.equal(senderAddress("staff"), "staff@r12.live");
    assert.equal(senderAddress("billing"), "madhouse.accounts@r12.live");
  } finally { for (const key of keys) { const value = previous[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test("SMTP accepts only complete authenticated TLS configuration and hides credentials from diagnostics", () => {
  const validEnv = { ...process.env, SMTP_HOST: "smtp.example.test", SMTP_PORT: "587", SMTP_SECURE: "false", SMTP_USERNAME: "user@example.test", SMTP_PASSWORD: "very-secret" };
  const config = inspectSmtpConfiguration(validEnv);
  assert.equal(config.state, "configured");
  assert.equal(config.configuration?.requireTLS, true);
  assert.equal(config.configuration?.username, "user@example.test");
  assert.doesNotMatch(JSON.stringify(config.checks), /very-secret|user@example/);
  assert.equal(inspectSmtpConfiguration({ ...process.env, SMTP_HOST: "smtp.example.test", SMTP_PORT: "25", SMTP_SECURE: "false", SMTP_USERNAME: "user", SMTP_PASSWORD: undefined }).state, "invalid");
});

test("SMTP transport sends multipart mail over an already-secured test socket and records acceptance", async () => {
  class FakeSmtpSocket extends EventEmitter {
    destroy() { this.emit("close"); }
    pause() { return this; }
    resume() { return this; }
    setTimeout() { return this; }
    write(chunk: string, callback?: (error?: Error | null) => void) {
      callback?.();
      const value = chunk.toString();
      let response = "";
      if (value.startsWith("EHLO")) response = "250-smtp.test\r\n250 AUTH LOGIN\r\n";
      else if (value.startsWith("AUTH LOGIN")) response = "334 VXNlcm5hbWU6\r\n";
      else if (value === `${Buffer.from("user").toString("base64")}\r\n`) response = "334 UGFzc3dvcmQ6\r\n";
      else if (value === `${Buffer.from("password").toString("base64")}\r\n`) response = "235 authenticated\r\n";
      else if (value.startsWith("MAIL FROM:") || value.startsWith("RCPT TO:")) response = "250 accepted\r\n";
      else if (value === "DATA\r\n") response = "354 send content\r\n";
      else if (value.endsWith("\r\n.\r\n")) response = "250 queued-id-123\r\n";
      else if (value === "QUIT\r\n") response = "221 bye\r\n";
      if (response) setImmediate(() => this.emit("data", Buffer.from(response)));
      return true;
    }
  }
  const socket = new FakeSmtpSocket();
  const result = await sendSmtpMessage({ id: "sample", recipientEmail: "member@example.test", sender: "members", subject: "Hello", text: "Plain copy", html: "<p>HTML copy</p>" }, {
    host: "smtp.example.test", port: 465, secure: true, requireTLS: false, username: "user", password: "password",
    from: { members: { address: "members@r12.live", name: "R12" }, staff: { address: "staff@r12.live", name: "R12" }, billing: { address: "billing@r12.live", name: "R12" } },
  }, async () => { setImmediate(() => socket.emit("data", Buffer.from("220 smtp.test ready\r\n"))); return socket as never; });
  assert.equal(result.provider, "smtp");
  assert.match(result.reference, /queued-id-123/);
});

test("SMTP transport failures are retry-classified without exposing relay error details", async () => {
  await assert.rejects(sendSmtpMessage({ id: "sample", recipientEmail: "member@example.test", sender: "members", subject: "Hello", text: "Text", html: "<p>Text</p>" }, {
    host: "smtp.example.test", port: 465, secure: true, requireTLS: false, username: "user", password: "do-not-log-this",
    from: { members: { address: "members@r12.live", name: "R12" }, staff: { address: "staff@r12.live", name: "R12" }, billing: { address: "billing@r12.live", name: "R12" } },
  }, async () => { throw new Error("relay-secret-error"); }), error => {
    assert.equal((error as { deliveryCode?: string }).deliveryCode, "smtp_transport_error");
    assert.equal((error as Error).message, "SMTP delivery failed");
    assert.doesNotMatch((error as Error).message, /relay-secret|do-not-log/);
    return true;
  });
});

test("unsupported email providers fail closed instead of reporting a send", async () => {
  const old = process.env.R12_EMAIL_PROVIDER;
  process.env.R12_EMAIL_PROVIDER = "unsupported-test-provider";
  try {
    assert.deepEqual(await deliverNotification({ id: "x", recipientEmail: "x@example.test", sender: "members", subject: "x", text: "x", html: "x" }), {
      ok: false, state: "unavailable", code: "email_provider_unavailable", message: "Transactional email delivery is not configured.", retryable: false,
    });
  } finally { if (old === undefined) delete process.env.R12_EMAIL_PROVIDER; else process.env.R12_EMAIL_PROVIDER = old; }
});

test("templates do not expose passwords or raw payment credentials", () => {
  const invitation = renderNotification({ templateKey: "staff_invitation", payload: { grantId: "grant-1", email: "staff@example.com", role: "trainer", organisationName: "Madhouse" } });
  assert.match(invitation.subject, /R12 staff access/);
  assert.match(invitation.text, /staff@example.com/);
  assert.doesNotMatch(invitation.text, /password|card number|bank account/i);
  const billing = renderNotification({ templateKey: "monthly_payment_failed", payload: {} });
  assert.match(billing.text, /payment/i);
  assert.doesNotMatch(billing.text, /raw|secret|token/i);
});

test("staff invitation previews use branded human role labels, access summary, expiry and claim CTA", () => {
  const renderStaff = (role: string, extras: Record<string, unknown> = {}) => renderNotification({ templateKey: "staff_invitation", payload: { name: "Keenan", email: "keenan@example.test", role, venueNames: ["Rotherham", "Carlton"], expiresAt: "2026-11-14T12:00:00Z", grantId: "preview-only", ...extras } });
  const owner = renderStaff("owner", { coachEnabled: true, testMode: true });
  assert.equal(owner.subject, "[TEST] Your R12 staff access is ready");
  assert.match(owner.text, /Welcome aboard, Keenan\./); assert.match(owner.text, /Your staff access is ready\./);
  assert.match(owner.text, /Role: Owner/); assert.match(owner.text, /Venues: Rotherham \+ Carlton/); assert.match(owner.text, /Coach\/PT: Enabled/);
  assert.match(owner.text, /Use keenan@example\.test to sign in or create your R12 account/);
  assert.match(owner.text, /Your invite is valid until 14 November 2026\./); assert.equal(owner.cta, "ACTIVATE STAFF ACCESS");
  assert.match(owner.destination, /\/club\/staff\/claim\?grant=/); assert.equal(owner.destinationType, "Staff access activation page");
  assert.match(owner.html, /R12 × MADHOUSE/); assert.match(owner.html, /MADHOUSE · ROTHERHAM · CARLTON/);
  assert.match(owner.html, /TEST EMAIL — nothing will be changed/); assert.match(owner.html, /alt="R12 × Madhouse Gym"/);
  assert.match(owner.html, /Everything’s ready when you are\./); assert.match(owner.text, /Your club\. Your progress\./);
  assert.doesNotMatch(owner.text, /gym_admin|gym_staff|trainer/);

  assert.match(renderStaff("gym_admin").text, /Role: Manager/);
  assert.match(renderStaff("trainer").text, /Role: PT \/ Coach/);
  assert.match(renderStaff("gym_staff").text, /Role: Operational Staff/);
  const noCoach = renderStaff("gym_admin");
  assert.doesNotMatch(noCoach.text, /Coach\/PT/);
  assert.doesNotMatch(noCoach.text, /gym_admin|gym_staff|trainer/);
  assert.equal(owner.sender, "staff"); assert.equal(owner.senderName, "R12 · Madhouse Staff"); assert.equal(owner.senderAddress, "staff@r12.live");
});

test("member activation uses the approved reassuring R12 × Madhouse copy in HTML and plain text", () => {
  const member = renderNotification({ templateKey: "member_activation", payload: { name: "Alex", organisationName: "Madhouse", testMode: true } });
  assert.equal(member.subject, "[TEST] Activate your R12 membership account");
  assert.match(member.text, /Your gym just got an upgrade\./);
  assert.match(member.text, /Your Madhouse membership is now on R12\./);
  assert.match(member.text, /You’re already a member — you’re not joining or paying again\./);
  assert.match(member.text, /ACTIVATE MY R12 ACCOUNT/);
  assert.match(member.text, /Already use R12\? Sign in\. New to R12\? Create an account with the same email address linked to your membership\./);
  assert.match(member.text, /Once you’re signed in, link your existing Madhouse membership\./);
  assert.match(member.text, /Same gym\. Much smarter\./); assert.match(member.text, /Your club\. Your progress\./);
  assert.match(member.destination, /\/member-hub\/link$/); assert.equal(member.destinationType, "R12 membership account link page");
  assert.match(member.html, /ACTIVATE MY R12 ACCOUNT/); assert.match(member.html, /R12 × MADHOUSE/);
  assert.doesNotMatch(member.text, /join now|buy now|subscription|membership id|phone|date of birth/i);
  assert.equal(member.sender, "members"); assert.equal(member.senderName, "R12 · Madhouse"); assert.equal(member.senderAddress, "members@r12.live");
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
