"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { clubCapabilities, resolveClubCapabilities } from "@/lib/club-capabilities";
import { nudgeNotificationWorker } from "@/lib/notification-nudge";
import { adminSupabase } from "@/lib/supabase-admin";
import { MADHOUSE_PRODUCTION_ORGANISATION_ID } from "@/lib/madhouse-catalogue";
import { R12_CANONICAL_AUTH_ORIGIN } from "@/lib/auth-return";
import { canManagerResetStaffPassword } from "@/lib/club-staff-password-policy";

async function staffManager(organisationId: string) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return undefined;
  const context = await resolveClubOperationalContext(client, user.id, organisationId);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "staff.permissions_manage"))) return undefined;
  return { client, context, user };
}

export async function sendStaffPasswordReset(input: { organisationId: string; targetUserId: string }) {
  try {
    const manager = await staffManager(input.organisationId);
    if (!manager || manager.context.organisation.id !== MADHOUSE_PRODUCTION_ORGANISATION_ID
      || !["owner", "gym_admin"].includes(manager.context.role)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.targetUserId)) {
      return { ok: false as const, code: "not_authorized" as const };
    }

    const { data: staffRows, error: staffError } = await manager.client.rpc("club_list_staff_accounts", { p_organisation_id: manager.context.organisation.id });
    if (staffError || !Array.isArray(staffRows)) return { ok: false as const, code: "failed" as const };
    const target = (staffRows as Array<Record<string, unknown>>).find(row => row.user_id === input.targetUserId);
    const targetRole = typeof target?.role === "string" ? target.role : "";
    if (!target || !canManagerResetStaffPassword(manager.context.role, targetRole, manager.user.id, input.targetUserId)) {
      return { ok: false as const, code: "not_authorized" as const };
    }

    const authUser = await adminSupabase().auth.admin.getUserById(input.targetUserId);
    const email = authUser.data.user?.email?.trim();
    const emailVerified = Boolean(authUser.data.user?.email_confirmed_at);
    if (authUser.error || !email || !emailVerified) return { ok: false as const, code: "no_verified_email" as const };

    // Audit the actor and target before asking Supabase Auth to send its
    // rate-limited, expiring recovery email. Tokens never enter this server action.
    const { error: auditError } = await manager.client.rpc("club_append_audit_event", {
      p_organisation_id: manager.context.organisation.id,
      p_action: "staff.password_reset.initiated",
      p_target_type: "staff_account",
      p_target_id: input.targetUserId,
      p_location_id: null,
      p_reason: null,
      p_metadata: { delivery: "supabase_auth_recovery" },
    });
    if (auditError) return { ok: false as const, code: "failed" as const };

    const params = new URLSearchParams({ app: "club", next: "/club" });
    const { error } = await manager.client.auth.resetPasswordForEmail(email, {
      redirectTo: `${R12_CANONICAL_AUTH_ORIGIN}/account/reset?${params.toString()}`,
    });
    if (error) return { ok: false as const, code: "failed" as const };
    revalidatePath("/club/staff");
    return { ok: true as const };
  } catch {
    return { ok: false as const, code: "failed" as const };
  }
}

export async function createStaffAccessGrant(input: { organisationId: string; email: string; displayName: string; role: "gym_staff" | "gym_admin" | "trainer"; locationIds: string[]; coachRequested: boolean; memberIntent: boolean }) {
  const manager = await staffManager(input.organisationId);
  if (!manager) return { ok: false as const, error: "You don’t have permission to manage staff access." };
  const expected = resolveClubCapabilities(input.role);
  if (input.coachRequested && input.role === "gym_staff") return { ok: false as const, error: "Coach access is available only to Managers and PTs." };
  const { error } = await manager.client.rpc("club_create_staff_access_grant", {
    p_organisation_id: manager.context.organisation.id,
    p_email: input.email,
    p_display_name: input.displayName,
    p_role: input.role,
    p_location_ids: input.locationIds,
    p_capabilities: expected,
    p_coach_requested: input.coachRequested,
    p_member_intent: input.memberIntent,
  });
  if (error?.code === "23505") return { ok: false as const, error: "Active or pending staff access already exists for that email." };
  if (error) return { ok: false as const, error: "Staff access could not be prepared." };
  nudgeNotificationWorker();
  revalidatePath("/club/staff");
  return { ok: true as const };
}

export async function revokeStaffAccessGrant(organisationId: string, grantId: string) {
  const manager = await staffManager(organisationId);
  if (!manager) return { ok: false as const, error: "You don’t have permission to manage staff access." };
  const { error } = await manager.client.rpc("club_revoke_staff_access_grant", { p_organisation_id: manager.context.organisation.id, p_grant_id: grantId });
  if (error) return { ok: false as const, error: "Pending access could not be revoked." };
  revalidatePath("/club/staff");
  return { ok: true as const };
}

export async function resendStaffInvitation(organisationId: string, grantId: string) {
  const manager = await staffManager(organisationId);
  if (!manager) return { ok: false as const, error: "You don’t have permission to manage staff invitations." };
  const { error } = await manager.client.rpc("club_resend_staff_invitation", { p_organisation_id: manager.context.organisation.id, p_grant_id: grantId });
  if (error) return { ok: false as const, error: "The invitation could not be queued." };
  nudgeNotificationWorker();
  revalidatePath("/club/staff");
  return { ok: true as const };
}

export async function linkOperationalStaffInvitation(input: { organisationId: string; assignmentId: string; grantId: string }) {
  const manager = await staffManager(input.organisationId);
  if (!manager) return { ok: false as const, error: "You don’t have permission to manage staff assignments." };
  const { error } = await manager.client.rpc("club_madhouse_attach_staff_invitation", {
    p_organisation_id: manager.context.organisation.id,
    p_assignment_id: input.assignmentId,
    p_grant_id: input.grantId,
  });
  if (error) return { ok: false as const, error: "The invitation could not be linked to the prepared class and rota identity." };
  revalidatePath("/club/staff");
  revalidatePath("/club/classes");
  revalidatePath("/club/schedule");
  return { ok: true as const };
}

export async function claimStaffAccessGrant(grantId: string) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false as const, error: "Sign in required." };
  const { data, error } = await client.rpc("club_claim_staff_access_grant", { p_grant_id: grantId });
  if (error) return { ok: false as const, error: "This access grant is unavailable." };
  revalidatePath("/club");
  revalidatePath("/club/staff/claim");
  revalidatePath("/coach");
  return { ok: true as const, result: data };
}

export async function activateExistingStaffAccessGrant(input: { organisationId: string; grantId: string }) {
  const manager = await staffManager(input.organisationId);
  if (!manager) return { ok: false as const, error: "You don’t have permission to manage staff access." };
  const { error } = await manager.client.rpc("club_activate_existing_staff_access_grant", {
    p_organisation_id: manager.context.organisation.id,
    p_grant_id: input.grantId,
  });
  if (error) return { ok: false as const, error: "The existing account could not be verified and activated from this invitation." };
  revalidatePath("/club/staff");
  revalidatePath("/club");
  revalidatePath("/coach");
  revalidatePath("/club/staff/claim");
  return { ok: true as const };
}

export async function replaceStaffLocations(input: { organisationId: string; userId: string; locationIds: string[] }) {
  const manager = await staffManager(input.organisationId);
  if (!manager) return { ok: false as const, error: "You don’t have permission to manage staff access." };
  const { error } = await manager.client.rpc("club_replace_staff_locations", { p_organisation_id: manager.context.organisation.id, p_user_id: input.userId, p_location_ids: input.locationIds });
  if (error) return { ok: false as const, error: "Locations could not be updated." };
  revalidatePath("/club/staff");
  return { ok: true as const };
}

export async function setStaffActive(input: { organisationId: string; userId: string; active: boolean }) {
  const manager = await staffManager(input.organisationId);
  if (!manager) return { ok: false as const, error: "You don’t have permission to manage staff access." };
  if (input.userId === manager.user.id && !input.active) return { ok: false as const, error: "You cannot deactivate your own Club access." };
  const { error } = await manager.client.rpc("club_set_staff_active", { p_organisation_id: manager.context.organisation.id, p_user_id: input.userId, p_active: input.active });
  if (error) return { ok: false as const, error: "Staff status could not be updated." };
  revalidatePath("/club/staff");
  return { ok: true as const };
}

export async function setStaffRole(input: { organisationId: string; userId: string; role: "gym_staff" | "trainer" | "gym_admin" }) {
  const manager = await staffManager(input.organisationId);
  if (!manager) return { ok: false as const, error: "You don’t have permission to manage staff access." };
  const { error } = await manager.client.rpc("club_set_staff_role", { p_organisation_id: manager.context.organisation.id, p_user_id: input.userId, p_role: input.role });
  if (error) return { ok: false as const, error: "Staff role could not be updated." };
  revalidatePath("/club/staff");
  return { ok: true as const };
}

export async function setStaffPermission(input: { organisationId: string; userId: string; capability: string; decision: "allow" | "deny" }) {
  const manager = await staffManager(input.organisationId);
  if (!manager) return { ok: false as const, error: "You don’t have permission to manage staff access." };
  if (!clubCapabilities.includes(input.capability as never)) return { ok: false as const, error: "Choose a valid permission." };
  const { error } = await manager.client.rpc("club_save_staff_permission", { p_organisation_id: manager.context.organisation.id, p_user_id: input.userId, p_capability: input.capability, p_decision: input.decision });
  if (error) return { ok: false as const, error: "Permission could not be updated." };
  revalidatePath("/club/staff");
  return { ok: true as const };
}

export async function setCoachAccess(input: { organisationId: string; userId: string; active: boolean }) {
  const manager = await staffManager(input.organisationId);
  if (!manager) return { ok: false as const, error: "You don’t have permission to manage Coach access." };
  const { error } = await manager.client.rpc("coach_grant_permission", { p_organisation_id: manager.context.organisation.id, p_user_id: input.userId, p_active: input.active });
  if (error) return { ok: false as const, error: "Coach access could not be updated." };
  revalidatePath("/club/staff");
  revalidatePath("/coach");
  return { ok: true as const };
}

export async function transferOrganisationOwner(organisationId: string, newOwnerUserId: string) {
  const manager = await staffManager(organisationId);
  if (!manager || manager.context.role !== "owner") return { ok: false as const, error: "Only the current Owner can transfer organisation ownership." };
  if (!newOwnerUserId || newOwnerUserId === manager.user.id) return { ok: false as const, error: "Choose another active person in this organisation." };
  const { error } = await manager.client.rpc("club_transfer_organisation_owner", { p_organisation_id: manager.context.organisation.id, p_new_owner_user_id: newOwnerUserId });
  if (error) return { ok: false as const, error: error.message.includes("active member") ? "The selected person must already have active access to this organisation." : "Ownership could not be transferred. Confirm you are the current Owner and try again." };
  revalidatePath("/club/staff");
  revalidatePath("/club");
  return { ok: true as const };
}
