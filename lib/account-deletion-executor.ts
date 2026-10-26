import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptDeletionAddress } from "@/lib/account-deletion-crypto";
import { deliverNotification } from "@/lib/notification-provider";

type ExecutionSecret = { request_id: string; user_id: string; execution_state: string; notification_ciphertext: string; notification_expires_at: string };
type PreparedExecution = { state: string; storage_objects?: Array<{ bucket_id: string; name: string }>; blockers?: unknown[] };

const missingUserCodes = new Set(["user_not_found", "not_found"]);

export async function executeAccountDeletion(
  admin: SupabaseClient,
  requestId: string,
  operatorId: string,
  dependencies: { deliver?: typeof deliverNotification } = {},
) {
  const secretResult = await admin.rpc("r12_get_account_deletion_execution_secret", { p_request_id: requestId, p_operator_id: operatorId });
  if (secretResult.error || !secretResult.data) throw new Error("execution_secret_unavailable");
  const secret = secretResult.data as ExecutionSecret;
  if (new Date(secret.notification_expires_at).getTime() <= Date.now()) throw new Error("notification_address_expired");
  const notificationAddress = decryptDeletionAddress(secret.notification_ciphertext);

  const prepare = await admin.rpc("r12_prepare_account_deletion", { p_request_id: requestId, p_operator_id: operatorId });
  if (prepare.error || !prepare.data) throw new Error("data_preparation_failed");
  const plan = prepare.data as PreparedExecution;
  if (plan.state === "held") return plan;

  for (const object of plan.storage_objects ?? []) {
    const removal = await admin.storage.from(object.bucket_id).remove([object.name]);
    if (removal.error) {
      await admin.rpc("r12_fail_account_deletion", { p_request_id: requestId, p_operator_id: operatorId, p_failure_code: "storage_removal_failed" });
      throw new Error("storage_removal_failed");
    }
  }
  const storageCheck = await admin.rpc("r12_confirm_account_deletion_storage", { p_request_id: requestId, p_operator_id: operatorId });
  if (storageCheck.error) throw new Error("storage_validation_failed");

  const deleted = await admin.auth.admin.deleteUser(secret.user_id, false);
  if (deleted.error && deleted.error.status !== 404 && !missingUserCodes.has(String(deleted.error.code))) {
    await admin.rpc("r12_fail_account_deletion", { p_request_id: requestId, p_operator_id: operatorId, p_failure_code: "auth_identity_deletion_failed" });
    throw new Error("auth_identity_deletion_failed");
  }
  const authCheck = await admin.auth.admin.getUserById(secret.user_id);
  if (!authCheck.error || (authCheck.error.status !== 404 && !missingUserCodes.has(String(authCheck.error.code)))) {
    await admin.rpc("r12_fail_account_deletion", { p_request_id: requestId, p_operator_id: operatorId, p_failure_code: "auth_identity_still_present" });
    throw new Error("auth_identity_still_present");
  }

  const finalized = await admin.rpc("r12_confirm_account_deletion_identity", { p_request_id: requestId, p_operator_id: operatorId });
  if (finalized.error) throw new Error("retained_record_validation_failed");
  const claim = await admin.rpc("r12_claim_account_deletion_notification", { p_request_id: requestId, p_operator_id: operatorId });
  const deliveryToken = typeof claim.data === "object" && claim.data && "delivery_token" in claim.data ? String(claim.data.delivery_token) : "";
  if (claim.error || !deliveryToken) throw new Error("notification_claim_failed");
  const delivery = await (dependencies.deliver ?? deliverNotification)({
    id: `account-deletion-${requestId}`,
    recipientEmail: notificationAddress,
    sender: "privacy",
    subject: "Your R12 account has been deleted",
    text: "Your shared R12 account has been deleted. This does not cancel any separate gym membership, recurring payment agreement, coaching agreement or other service. Contact the relevant organisation or provider to manage those services.",
    html: "<p>Your shared R12 account has been deleted.</p><p>This does not cancel any separate gym membership, recurring payment agreement, coaching agreement or other service. Contact the relevant organisation or provider to manage those services.</p>",
  });
  if (!delivery.ok) {
    await admin.rpc("r12_release_account_deletion_notification", { p_request_id: requestId, p_operator_id: operatorId, p_delivery_token: deliveryToken, p_failure_code: delivery.code });
    return { state: "notification_pending", notification: delivery.code };
  }
  const completed = await admin.rpc("r12_complete_account_deletion", { p_request_id: requestId, p_operator_id: operatorId, p_delivery_token: deliveryToken, p_delivery_reference: delivery.reference });
  if (completed.error || !completed.data) throw new Error("completion_record_failed");
  return completed.data;
}

