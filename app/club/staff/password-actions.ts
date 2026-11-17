"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { adminSupabase } from "@/lib/supabase-admin";
import { MADHOUSE_PRODUCTION_ORGANISATION_ID } from "@/lib/madhouse-catalogue";
import { R12_CANONICAL_AUTH_ORIGIN } from "@/lib/auth-return";
import { canManagerChangeStaffPassword, isDirectPasswordManager } from "@/lib/club-staff-password-policy";
import { validateAuthPassword } from "@/lib/auth-password-policy";

async function staffPasswordManager(organisationId: string) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return undefined;
  const context = await resolveClubOperationalContext(client, user.id, organisationId);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "staff.permissions_manage"))) return undefined;
  return { client, context, user };
}

async function authorisedTarget(organisationId: string, targetUserId: string) {
  const manager = await staffPasswordManager(organisationId);
  if (!manager || manager.context.organisation.id !== MADHOUSE_PRODUCTION_ORGANISATION_ID
    || !isDirectPasswordManager(manager.user.id)
    || !["owner", "gym_admin"].includes(manager.context.role)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) return undefined;

  const { data: staffRows, error } = await manager.client.rpc("club_list_staff_accounts", { p_organisation_id: manager.context.organisation.id });
  if (error || !Array.isArray(staffRows)) return undefined;
  const target = (staffRows as Array<Record<string, unknown>>).find(row => row.user_id === targetUserId);
  const role = typeof target?.role === "string" ? target.role : "";
  if (!target || !canManagerChangeStaffPassword(manager.user.id, manager.context.role, targetUserId, role)) return undefined;
  return manager;
}

export async function sendStaffPasswordReset(input: { organisationId: string; targetUserId: string }) {
  try {
    const manager = await authorisedTarget(input.organisationId, input.targetUserId);
    if (!manager) return { ok: false as const, code: "not_authorized" as const };
    const authUser = await adminSupabase().auth.admin.getUserById(input.targetUserId);
    const email = authUser.data.user?.email?.trim();
    if (authUser.error || !email || !authUser.data.user?.email_confirmed_at) return { ok: false as const, code: "no_verified_email" as const };

    const { error: startError } = await manager.client.rpc("club_append_audit_event", {
      p_organisation_id: manager.context.organisation.id,
      p_action: "staff.password_reset_email.initiated",
      p_target_type: "staff_account",
      p_target_id: input.targetUserId,
      p_location_id: null,
      p_reason: null,
      p_metadata: { delivery: "supabase_auth_recovery" },
    });
    if (startError) return { ok: false as const, code: "failed" as const };

    const params = new URLSearchParams({ app: "club", next: "/club" });
    const { error } = await manager.client.auth.resetPasswordForEmail(email, {
      redirectTo: `${R12_CANONICAL_AUTH_ORIGIN}/account/reset?${params.toString()}`,
    });
    const { error: auditError } = await manager.client.rpc("club_append_audit_event", {
      p_organisation_id: manager.context.organisation.id,
      p_action: error ? "staff.password_reset_email.failed" : "staff.password_reset_email.sent",
      p_target_type: "staff_account",
      p_target_id: input.targetUserId,
      p_location_id: null,
      p_reason: null,
      p_metadata: { delivery: "supabase_auth_recovery" },
    });
    if (error || auditError) return { ok: false as const, code: "failed" as const };
    revalidatePath("/club/staff");
    return { ok: true as const };
  } catch {
    return { ok: false as const, code: "failed" as const };
  }
}

export async function changeStaffPassword(input: { organisationId: string; targetUserId: string; password: string; confirmation: string; requirePasswordChange: boolean }) {
  try {
    const manager = await authorisedTarget(input.organisationId, input.targetUserId);
    if (!manager) return { ok: false as const, code: "not_authorized" as const };

    const validation = validateAuthPassword(input.password, input.confirmation);
    if (typeof input.requirePasswordChange !== "boolean") return { ok: false as const, code: "failed" as const };
    const { error: startError } = await manager.client.rpc("club_append_audit_event", {
      p_organisation_id: manager.context.organisation.id,
      p_action: validation ? "staff.password_change.failed" : "staff.password_change.started",
      p_target_type: "staff_account",
      p_target_id: input.targetUserId,
      p_location_id: null,
      p_reason: null,
      p_metadata: { outcome: validation ? "rejected_before_auth" : "started", reason: validation ?? null, require_password_change_next_login: input.requirePasswordChange },
    });
    if (startError) return { ok: false as const, code: "failed" as const };
    if (validation) return { ok: false as const, code: validation };

    // Plaintext is used only as an Auth Admin request field, never logged or audited.
    let succeeded = false;
    try {
      const auth = adminSupabase();
      const { data, error } = await auth.auth.admin.getUserById(input.targetUserId);
      if (!error && data.user) {
        const appMetadata = { ...data.user.app_metadata, password_change_required: input.requirePasswordChange };
        const result = await auth.auth.admin.updateUserById(input.targetUserId, { password: input.password, app_metadata: appMetadata });
        succeeded = !result.error;
      }
    } catch {
      succeeded = false;
    }

    const { error: auditError } = await manager.client.rpc("club_append_audit_event", {
      p_organisation_id: manager.context.organisation.id,
      p_action: succeeded ? "staff.password_change.succeeded" : "staff.password_change.failed",
      p_target_type: "staff_account",
      p_target_id: input.targetUserId,
      p_location_id: null,
      p_reason: null,
      p_metadata: { outcome: succeeded ? "success" : "auth_rejected", require_password_change_next_login: input.requirePasswordChange },
    });
    if (auditError) return { ok: succeeded, code: succeeded ? "audit_unavailable" as const : "failed" as const };
    if (!succeeded) return { ok: false as const, code: "auth_rejected" as const };
    revalidatePath("/club/staff");
    return { ok: true as const, code: "succeeded" as const };
  } catch {
    return { ok: false as const, code: "failed" as const };
  }
}
