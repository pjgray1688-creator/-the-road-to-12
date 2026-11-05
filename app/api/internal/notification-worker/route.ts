import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deliverNotification, notificationTransportAvailable } from "@/lib/notification-provider";
import { renderNotification, type NotificationTemplateKey } from "@/lib/notification-templates";
import { notificationWorkerLimits, shouldRetry, retryDelaySeconds, workerId } from "@/lib/notification-worker";
import { verifyInternalWorkerAuth } from "@/lib/internal-worker-auth";
import { renderMadhouseApparelEmail } from "@/lib/madhouse-apparel-email";

export const runtime = "nodejs";
export const maxDuration = 300;

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Notification worker database configuration is missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(request: NextRequest) {
  const auth = verifyInternalWorkerAuth(request, [process.env.R12_NOTIFICATION_WORKER_SECRET, process.env.CRON_SECRET]);
  if (auth === "missing_configuration") return NextResponse.json({ error: "Notification worker authentication is not configured" }, { status: 503 });
  if (auth === "unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let operation = "database_configuration";
  try {
    const client = admin();
    operation = "apparel_outbox";
    const apparelSenderReady = process.env.MADHOUSE_APPAREL_EMAIL_SENDER_VERIFIED === "true"
      && /^[^\s@<>]+@madhousegym\.online$/i.test(process.env.MADHOUSE_APPAREL_EMAIL_FROM?.trim() ?? "");
    const { data: apparelRows, error: apparelError } = apparelSenderReady
      ? await client.from("club_madhouse_apparel_email_outbox").select("id,order_id,event_key,recipient_email,template_key,attempts").eq("state", "queued").order("created_at", { ascending: true }).limit(30)
      : { data: [], error: null };
    if (apparelError) throw apparelError;
    let apparelSent = 0; let apparelSuppressed = 0; let apparelFailed = 0;
    for (const candidate of apparelRows ?? []) {
      const { data: claimed, error: claimError } = await client.from("club_madhouse_apparel_email_outbox")
        .update({ state: "sending", attempts: Number(candidate.attempts ?? 0) + 1 }).eq("id", candidate.id).eq("state", "queued").select("id").maybeSingle();
      if (claimError || !claimed) continue;
      const { data: context, error: contextError } = await client.rpc("club_get_madhouse_apparel_email_context", { p_order_id: candidate.order_id });
      if (contextError || !context) {
        await client.from("club_madhouse_apparel_email_outbox").update({ state: "failed" }).eq("id", candidate.id).eq("state", "sending");
        apparelFailed++; continue;
      }
      try {
        const message = renderMadhouseApparelEmail(candidate.template_key, context as Parameters<typeof renderMadhouseApparelEmail>[1]);
        const delivery = await deliverNotification({ id: candidate.id, recipientEmail: candidate.recipient_email, sender: "apparel", ...message });
        const state = delivery.ok ? "sent" : delivery.state === "unavailable" ? "suppressed" : "failed";
        const { error: stateError } = await client.from("club_madhouse_apparel_email_outbox").update({ state, subject: message.subject,
          html_body: message.html, text_body: message.text, provider_reference: delivery.ok ? delivery.reference : null,
          sent_at: delivery.ok ? new Date().toISOString() : null }).eq("id", candidate.id).eq("state", "sending");
        if (stateError) apparelFailed++; else if (delivery.ok) apparelSent++; else if (state === "suppressed") apparelSuppressed++; else apparelFailed++;
      } catch {
        await client.from("club_madhouse_apparel_email_outbox").update({ state: "failed" }).eq("id", candidate.id).eq("state", "sending");
        apparelFailed++;
      }
    }
    if (!notificationTransportAvailable()) return NextResponse.json({ apparelSent, apparelSuppressed, apparelFailed, apparelBlocked: !apparelSenderReady, error: "R12 notification delivery adapter is unavailable." }, { status: 503 });
    operation = "generate_intents";
    const { error: generationError } = await client.rpc("club_generate_notification_intents");
    if (generationError) throw generationError;
    const limits = notificationWorkerLimits();
    const startedAt = Date.now();
    let claimed = 0; let sent = 0; let unavailable = 0; let failed = 0; let stateUpdateFailures = 0; let batches = 0;
    const processRow = async (row: { id: string; target_email: string; template_key: NotificationTemplateKey; payload: Record<string, unknown> | null; attempts: number }) => {
      const rendered = renderNotification({ templateKey: row.template_key, payload: row.payload ?? {} });
      const result = await deliverNotification({ id: row.id, recipientEmail: row.target_email, sender: rendered.sender, subject: rendered.subject, text: rendered.text, html: rendered.html });
      if (result.ok) {
        const { error: stateError } = await client.rpc("club_complete_notification_intent", { p_id: row.id, p_provider_reference: result.reference });
        if (stateError) { stateUpdateFailures++; console.error("[notifications] completion state could not be saved", { code: stateError.code }); }
        else sent++;
        return;
      }
      if (result.state === "unavailable") unavailable++; else failed++;
      const { error: stateError } = await client.rpc("club_fail_notification_intent", { p_id: row.id, p_code: result.code, p_message: result.message, p_retry_at: shouldRetry(row.attempts, result.retryable) ? new Date(Date.now() + retryDelaySeconds(row.attempts) * 1000).toISOString() : null, p_terminal_state: result.state });
      if (stateError) { stateUpdateFailures++; console.error("[notifications] failure state could not be saved", { code: stateError.code }); }
    };
    while (batches < limits.maxBatches && Date.now() - startedAt < limits.runtimeBudgetMs) {
      const remainingMs = limits.runtimeBudgetMs - (Date.now() - startedAt);
      const runtimeSafeBatchSize = Math.floor((remainingMs / limits.messageTimeoutMs) * limits.sendConcurrency);
      if (runtimeSafeBatchSize < 1) break;
      operation = "claim_intents";
      const { data: rows, error } = await client.rpc("club_claim_notification_intents_for_worker", {
        p_limit: Math.min(limits.batchSize, runtimeSafeBatchSize),
        p_worker_id: workerId(),
        p_include_member_activation: process.env.R12_MEMBER_ACTIVATION_EMAILS_ENABLED === "true",
      });
      if (error) throw error;
      const batch = Array.isArray(rows) ? rows as Array<{ id: string; target_email: string; template_key: string; payload: Record<string, unknown> | null; attempts: number }> : [];
      if (!batch.length) break;
      batches++;
      claimed += batch.length;
      for (let offset = 0; offset < batch.length; offset += limits.sendConcurrency) {
        operation = "deliver_or_update_state";
        await Promise.all(batch.slice(offset, offset + limits.sendConcurrency).map(row => processRow({ ...row, template_key: row.template_key as NotificationTemplateKey })));
      }
    }
    const summary = { apparelSent, apparelSuppressed, apparelFailed, apparelBlocked: !apparelSenderReady, claimed, sent, unavailable, failed, stateUpdateFailures, batches, maxMessagesPerRun: limits.maxMessagesPerRun, runtimeBudgetMs: limits.runtimeBudgetMs };
    return NextResponse.json(stateUpdateFailures ? { ...summary, error: "Some notification delivery states could not be saved; review worker logs." } : summary, { status: stateUpdateFailures ? 500 : 200 });
  } catch (error) {
    const source = error as { code?: unknown; message?: unknown };
    const databaseConfigMissing = source instanceof Error && source.message === "Notification worker database configuration is missing";
    console.error("[notifications] worker failed", { code: typeof source.code === "string" ? source.code : "UNKNOWN", operation });
    return NextResponse.json({ error: databaseConfigMissing ? "Notification worker database configuration is missing" : "Notification worker failed; review protected server logs." }, { status: 500 });
  }
}

