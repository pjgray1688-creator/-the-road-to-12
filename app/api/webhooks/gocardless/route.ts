import { NextRequest, NextResponse } from "next/server";
import { verifyGoCardlessSignature } from "@/lib/join-provider-crypto";
import { goCardlessJoinEvent } from "@/lib/join-provider-events";
import { adminSupabase } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type GoCardlessEvent = { id: string; created_at: string; resource_type: string; action: string; links?: { mandate?: string } };

export async function POST(request: NextRequest) {
  const body = await request.text();
  const secret = process.env.GOCARDLESS_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "GoCardless webhook is not configured" }, { status: 503 });
  if (!verifyGoCardlessSignature(body, request.headers.get("webhook-signature"), secret)) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  let events: GoCardlessEvent[];
  try { const value = JSON.parse(body) as { events?: GoCardlessEvent[] }; events = Array.isArray(value.events) ? value.events : []; }
  catch { return NextResponse.json({ error: "Invalid payload" }, { status: 400 }); }
  try {
    const admin = adminSupabase();
    for (const event of events) {
      const parsed = goCardlessJoinEvent(event);
      if (!parsed) continue;
      const { data: requestId, error: lookupError } = await admin.rpc("club_find_join_request_by_provider_reference", { p_provider_type: "gocardless", p_provider_reference: parsed.reference });
      if (lookupError || !requestId) throw lookupError ?? new Error("Mandate has not been linked yet");
      const { error } = await admin.rpc("club_record_join_provider_event", {
        p_request_id: requestId, p_provider_type: "gocardless", p_provider_event_key: event.id, p_event_type: parsed.eventType,
        p_amount_minor: null, p_provider_reference: parsed.reference, p_occurred_at: parsed.occurredAt,
      });
      if (error) throw error;
    }
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "GoCardless events could not be recorded" }, { status: 500 });
  }
}
