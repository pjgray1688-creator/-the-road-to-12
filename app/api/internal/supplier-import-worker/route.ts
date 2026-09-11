import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase worker configuration is missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const client = adminClient();
    const { data: claimed, error: claimError } = await client.rpc("club_claim_supplier_import_jobs", { p_limit: 1 });
    if (claimError) throw claimError;
    const ids = Array.isArray(claimed) ? claimed : [];
    const results: Array<Record<string, unknown>> = [];
    for (const id of ids) {
      const { data, error } = await client.rpc("club_run_supplier_import_job", { p_job_id: id });
      results.push({ jobId: id, ok: !error, result: data ?? null, error: error?.message ?? null });
    }
    return NextResponse.json({ claimed: ids.length, results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Worker execution failed" }, { status: 500 });
  }
}
