import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deliverNotification } from "@/lib/notification-provider";
import { renderNotification } from "@/lib/notification-templates";
import { shouldRetry, retryDelaySeconds, workerId } from "@/lib/notification-worker";

export const runtime = "nodejs";
export const maxDuration = 300;

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Notification worker configuration is missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(request: NextRequest) {
  const secret = process.env.R12_NOTIFICATION_WORKER_SECRET ?? process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const client = admin();
    const { data: rows, error } = await client.rpc("club_claim_notification_intents", { p_limit: 25, p_worker_id: workerId() });
    if (error) throw error;
    let sent = 0; let unavailable = 0; let failed = 0;
    for (const row of Array.isArray(rows) ? rows : []) {
      const rendered = renderNotification({ templateKey: row.template_key, payload: row.payload ?? {} });
      const result = await deliverNotification({ id: row.id, recipientEmail: row.target_email, sender: rendered.sender, subject: rendered.subject, text: rendered.text, html: rendered.html });
      if (result.ok) { sent++; await client.rpc("club_complete_notification_intent", { p_id: row.id, p_provider_reference: result.reference }); continue; }
      if (result.state === "unavailable") unavailable++; else failed++;
      await client.rpc("club_fail_notification_intent", { p_id: row.id, p_code: result.code, p_message: result.message, p_retry_at: shouldRetry(row.attempts, result.retryable) ? new Date(Date.now() + retryDelaySeconds(row.attempts) * 1000).toISOString() : null, p_terminal_state: result.state });
    }
    return NextResponse.json({ claimed: Array.isArray(rows) ? rows.length : 0, sent, unavailable, failed });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Notification worker failed" }, { status: 500 });
  }
}

