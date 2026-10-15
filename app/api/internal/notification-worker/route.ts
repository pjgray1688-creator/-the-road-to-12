import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deliverNotification, notificationTransportAvailable } from "@/lib/notification-provider";
import { renderNotification, type NotificationTemplateKey } from "@/lib/notification-templates";
import { notificationWorkerLimits, shouldRetry, retryDelaySeconds, workerId } from "@/lib/notification-worker";
import { verifyInternalWorkerAuth } from "@/lib/internal-worker-auth";

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
  if (!notificationTransportAvailable()) return NextResponse.json({ error: "Notification delivery adapter is unavailable; no intents were claimed." }, { status: 503 });
  try {
    const client = admin();
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
        await Promise.all(batch.slice(offset, offset + limits.sendConcurrency).map(row => processRow({ ...row, template_key: row.template_key as NotificationTemplateKey })));
      }
    }
    const summary = { claimed, sent, unavailable, failed, stateUpdateFailures, batches, maxMessagesPerRun: limits.maxMessagesPerRun, runtimeBudgetMs: limits.runtimeBudgetMs };
    return NextResponse.json(stateUpdateFailures ? { ...summary, error: "Some notification delivery states could not be saved; review worker logs." } : summary, { status: stateUpdateFailures ? 500 : 200 });
  } catch (error) {
    const source = error as { code?: unknown; message?: unknown };
    const databaseConfigMissing = source instanceof Error && source.message === "Notification worker database configuration is missing";
    console.error("[notifications] worker failed", { code: typeof source.code === "string" ? source.code : "UNKNOWN" });
    return NextResponse.json({ error: databaseConfigMissing ? "Notification worker database configuration is missing" : "Notification worker failed; review protected server logs." }, { status: 500 });
  }
}

