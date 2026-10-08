import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { runGoCardlessCollections } from "@/lib/gocardless-recurring";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.R12_BILLING_WORKER_SECRET ?? process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await runGoCardlessCollections(adminSupabase()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Membership billing worker failed" }, { status: 500 });
  }
}
