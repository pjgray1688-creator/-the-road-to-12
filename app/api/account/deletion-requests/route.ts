import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase-admin";
import { serverSupabase } from "@/lib/supabase-server";

const noStore = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });

async function getPrivacyOperator() {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const allowed = new Set((process.env.R12_PRIVACY_OPERATOR_USER_IDS ?? "").split(",").map(value => value.trim()).filter(Boolean));
  if (!user?.email || !allowed.has(user.id)) return null;
  return user;
}

export async function GET() {
  try {
    const operator = await getPrivacyOperator();
    if (!operator) return fail("Privacy request access is unavailable.", 403);
    const { data, error } = await adminSupabase().rpc("r12_list_account_deletion_requests");
    if (error) return fail("The privacy request queue is unavailable.", 503);
    return NextResponse.json({ requests: Array.isArray(data) ? data : [] }, { headers: noStore });
  } catch {
    return fail("The privacy request queue is unavailable.", 503);
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return fail("This request could not be verified.", 403);
  try {
    const operator = await getPrivacyOperator();
    if (!operator) return fail("Privacy request access is unavailable.", 403);
    const body = await request.json().catch(() => null) as {
      requestId?: unknown; status?: unknown; responseMessage?: unknown; password?: unknown; confirmation?: unknown;
      retentionReviewed?: unknown; eligibleDataProcessed?: unknown;
    } | null;
    const password = typeof body?.password === "string" ? body.password : "";
    if (!operator.email || !password || password.length > 1024 || body?.confirmation !== "PROCESS") return fail("Re-enter your password and type PROCESS to confirm.", 400);
    if (typeof body?.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.requestId)
      || !["in_progress", "completed", "unable_to_complete"].includes(String(body.status))
      || typeof body.responseMessage !== "string" || body.responseMessage.trim().length < 1 || body.responseMessage.trim().length > 600) {
      return fail("Check the request update and response message.", 400);
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return fail("The privacy request queue is unavailable.", 503);
    const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const verified = await verifier.auth.signInWithPassword({ email: operator.email, password });
    if (verified.error || verified.data.user?.id !== operator.id) return fail("Password confirmation failed.", 401);

    const status = body.status as "in_progress" | "completed" | "unable_to_complete";
    const retentionReviewed = body.retentionReviewed === true;
    const eligibleDataProcessed = body.eligibleDataProcessed === true;
    if (status === "completed" && (!retentionReviewed || !eligibleDataProcessed)) return fail("Complete both retention and eligible-data checks before confirming completion.", 400);
    const { data, error } = await adminSupabase().rpc("r12_process_account_deletion_request", {
      p_request_id: body.requestId,
      p_operator_id: operator.id,
      p_status: status,
      p_response_message: body.responseMessage.trim(),
      p_retention_reviewed: retentionReviewed,
      p_eligible_data_processed: eligibleDataProcessed,
    });
    if (error || !data) return fail("The request could not be updated. Refresh the queue and try again.", 409);
    return NextResponse.json(data, { headers: noStore });
  } catch {
    return fail("The request could not be updated. Try again.", 503);
  }
}
