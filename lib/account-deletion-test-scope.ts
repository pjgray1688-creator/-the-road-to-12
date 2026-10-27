import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { NotificationDelivery, NotificationEnvelope } from "@/lib/notification-provider";
import { disposableDeletionTestEmail, isExactDisposableDeletionTestUser, validateDeletionTestRunId } from "@/lib/account-deletion-test-account";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const postAuthDeletionStates = new Set(["notification_pending", "notification_sending"]);

type ExecutionSecret = { user_id?: unknown; execution_state?: unknown };

export type DeletionExecutionAuthorization =
  | { mode: "live" }
  | { mode: "disposable_test"; runId: string; userId: string; expectedEmail: string };

export async function authorizeDeletionExecution(
  admin: SupabaseClient,
  requestId: string,
  operatorId: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<DeletionExecutionAuthorization | null> {
  if (environment.R12_ACCOUNT_DELETION_EXECUTION_ENABLED === "true") return { mode: "live" };

  const configuredUserId = environment.R12_ACCOUNT_DELETION_TEST_USER_ID?.trim() ?? "";
  const configuredRunId = environment.R12_ACCOUNT_DELETION_TEST_RUN_ID?.trim() ?? "";
  if (!uuidPattern.test(configuredUserId) || !configuredRunId) return null;

  let runId: string;
  try { runId = validateDeletionTestRunId(configuredRunId); } catch { return null; }

  const secretResult = await admin.rpc("r12_get_account_deletion_execution_secret", {
    p_request_id: requestId,
    p_operator_id: operatorId,
  });
  const secret = secretResult.data as ExecutionSecret | null;
  const targetUserId = typeof secret?.user_id === "string" ? secret.user_id : "";
  const executionState = typeof secret?.execution_state === "string" ? secret.execution_state : "";
  if (secretResult.error || targetUserId !== configuredUserId) return null;

  const authResult = await admin.auth.admin.getUserById(targetUserId);
  if (!authResult.error && authResult.data.user) {
    if (!isExactDisposableDeletionTestUser(authResult.data.user as User, runId)) return null;
  } else if (!postAuthDeletionStates.has(executionState)) {
    return null;
  }

  return {
    mode: "disposable_test",
    runId,
    userId: configuredUserId,
    expectedEmail: disposableDeletionTestEmail(runId),
  };
}
export function disposableTestNotificationSink(authorization: Extract<DeletionExecutionAuthorization, { mode: "disposable_test" }>) {
  return async (envelope: NotificationEnvelope): Promise<NotificationDelivery> => {
    if (envelope.recipientEmail.toLowerCase() !== authorization.expectedEmail) {
      return { ok: false, state: "failed", code: "test_recipient_mismatch", message: "Disposable test recipient did not match.", retryable: false };
    }
    return {
      ok: true,
      provider: "r12-disposable-test-sink",
      reference: `disposable-test:${authorization.runId}:${envelope.id}`,
    };
  };
}
