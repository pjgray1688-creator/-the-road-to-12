import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { runGoCardlessCollections } from "@/lib/gocardless-recurring";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.R12_BILLING_WORKER_SECRET ?? process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Membership billing worker authentication is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runGoCardlessCollections(adminSupabase()));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const safeConfigurationError = message === "Direct Debit setup is not configured" || message === "GoCardless environment must be sandbox or live";
    console.error("[membership-billing-worker] run failed", { code: (error as { code?: unknown } | null)?.code ?? "UNKNOWN" });
    return NextResponse.json({ error: safeConfigurationError ? message : "Membership billing worker failed; review protected server logs." }, { status: 500 });
  }
}
