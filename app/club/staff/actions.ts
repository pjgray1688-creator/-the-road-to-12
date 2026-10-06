"use server";

import { revalidatePath } from "next/cache";
import { serverSupabase } from "@/lib/supabase-server";
import { resolveClubOperationalContext } from "@/lib/club-server-context";
import { clubCapabilities, resolveClubCapabilities } from "@/lib/club-capabilities";

async function staffManager(organisationId: string) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return undefined;
  const context = await resolveClubOperationalContext(client, user.id, organisationId);
  if (!context || !(await context.repository.hasCapability(context.organisation.id, user.id, "staff.permissions_manage"))) return undefined;
  return { client, context, user };
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
  revalidatePath("/club/staff");
  return { ok: true as const };
}

export async function claimStaffAccessGrant(grantId: string) {
  const client = await serverSupabase();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { ok: false as const, error: "Sign in required." };
  const { data, error } = await client.rpc("club_claim_staff_access_grant", { p_grant_id: grantId });
  if (error) return { ok: false as const, error: "This access grant is unavailable." };
  revalidatePath("/club");
  return { ok: true as const, result: data };
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
