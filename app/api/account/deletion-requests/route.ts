import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { encryptDeletionAddress } from "@/lib/account-deletion-crypto";
import { executeAccountDeletion } from "@/lib/account-deletion-executor";
import { authorizeDeletionExecution, disposableTestNotificationSink } from "@/lib/account-deletion-test-scope";
import { privacyOperatorFromUser } from "@/lib/privacy-operator";
import { adminSupabase } from "@/lib/supabase-admin";
import { serverSupabase } from "@/lib/supabase-server";

const noStore = { "Cache-Control": "private, no-store" };
const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: noStore });
const requestIdPattern = /^[0-9a-f-]{36}$/i;
const retentionCategories = ["accounting", "membership", "transactions_refunds", "safety", "audit"] as const;

async function getPrivacyOperator() {
  const supabase = await serverSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return privacyOperatorFromUser(user);
}

async function reauthenticate(email: string, userId: string, password: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return false;
  const verifier = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const verified = await verifier.auth.signInWithPassword({ email, password });
  return !verified.error && verified.data.user?.id === userId;
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
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const requestId = typeof body?.requestId === "string" ? body.requestId : "";
    const action = typeof body?.action === "string" ? body.action : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!requestIdPattern.test(requestId) || !["review", "approve", "execute", "retry_notification"].includes(action)) return fail("Check the privacy operation.", 400);
    if (!password || password.length > 1024 || !(await reauthenticate(operator.email, operator.id, password))) return fail("Password confirmation failed.", 401);

    const admin = adminSupabase();
    if (action === "review") {
      if (body?.confirmation !== "REVIEW") return fail("Type REVIEW to record the retention review.", 400);
      const responseMessage = typeof body.responseMessage === "string" ? body.responseMessage.trim() : "";
      const decisions = body.retentionDecisions as Record<string, unknown> | null;
      if (!responseMessage || responseMessage.length > 600 || !decisions
        || retentionCategories.some(category => {
          const decision = decisions[category] as Record<string, unknown> | undefined;
          return !decision || !["retain", "hold"].includes(String(decision.decision))
            || typeof decision.rationale !== "string" || decision.rationale.trim().length < 3 || decision.rationale.trim().length > 500;
        })) return fail("Record a retain or hold decision and rationale for every retention category.", 400);
      const target = await admin.rpc("r12_get_account_deletion_review_target", { p_request_id: requestId, p_operator_id: operator.id });
      const targetId = typeof target.data === "object" && target.data && "user_id" in target.data ? String(target.data.user_id) : "";
      if (target.error || !requestIdPattern.test(targetId)) return fail("This deletion request is not available for review.", 409);
      const authUser = await admin.auth.admin.getUserById(targetId);
      if (authUser.error || !authUser.data.user?.email || !authUser.data.user.email_confirmed_at) return fail("The account has no verified notification address. Place the request on hold.", 409);
      const reviewed = await admin.rpc("r12_review_account_deletion", {
        p_request_id: requestId, p_operator_id: operator.id, p_operator_name: operator.name,
        p_retention_plan: decisions, p_response_message: responseMessage,
        p_notification_ciphertext: encryptDeletionAddress(authUser.data.user.email),
      });
      if (reviewed.error || !reviewed.data) return fail("The reviewed plan could not be recorded.", 409);
      return NextResponse.json(reviewed.data, { headers: noStore });
    }

    if (action === "approve") {
      if (body?.confirmation !== "APPROVE") return fail("Type APPROVE to provide independent approval.", 400);
      const approved = await admin.rpc("r12_approve_account_deletion", { p_request_id: requestId, p_operator_id: operator.id, p_operator_name: operator.name });
      if (approved.error || !approved.data) return fail("A different named operator must approve the unchanged review plan.", 409);
      return NextResponse.json(approved.data, { headers: noStore });
    }

    if (body?.confirmation !== "EXECUTE") return fail("Type EXECUTE to run the approved deletion.", 400);
    const authorization = await authorizeDeletionExecution(admin, requestId, operator.id);
    if (!authorization) return fail("Account deletion execution is disabled for this account.", 503);
    const result = await executeAccountDeletion(admin, requestId, operator.id,
      authorization.mode === "disposable_test"
        ? { deliver: disposableTestNotificationSink(authorization), expectedUserId: authorization.userId }
        : {});
    if ((result as { state?: string }).state === "held") return NextResponse.json({ error: "Execution is held by unresolved retention or dependency review.", ...result }, { status: 409, headers: noStore });
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    const safe: Record<string, string> = {
      notification_address_expired: "The protected notification address expired. A new review is required.",
      storage_removal_failed: "A reviewed Storage object could not be removed. Execution stopped before Auth deletion.",
      auth_identity_deletion_failed: "Eligible data was processed, but Auth identity deletion failed. The request remains incomplete.",
      auth_identity_still_present: "Auth identity removal could not be confirmed. The request remains incomplete.",
      execution_target_changed: "The approved deletion target changed. Execution stopped before data preparation.",
    };
    return fail(safe[code] ?? "The deletion operation stopped safely and was not marked complete.", 503);
  }
}
