import type { SupabaseClient } from "@supabase/supabase-js";

type LinkedIdentity = { userId: string; displayName?: string };

/** Prefer the current linked R12 profile identity over a class-session snapshot. */
export function resolveInstructorName(hostUserId: string | null | undefined, identities: readonly LinkedIdentity[], sessionSnapshot?: string | null): string {
  if (hostUserId) {
    const identity = identities.find(item => item.userId === hostUserId);
    return identity?.displayName?.trim() || "Instructor name unavailable";
  }
  return sessionSnapshot?.trim() || "Instructor not assigned";
}

/** Read linked staff names through the existing authorised Club RPCs. */
export async function listLinkedInstructorIdentities(client: SupabaseClient, organisationId: string): Promise<LinkedIdentity[]> {
  const scheduled = await client.rpc("club_list_schedule_staff", { p_organisation_id: organisationId });
  const scheduledIdentities = Array.isArray(scheduled.data) ? scheduled.data.flatMap((row: unknown) => {
    if (!row || typeof row !== "object") return [];
    const item = row as { userId?: unknown; name?: unknown };
    return typeof item.userId === "string" ? [{ userId: item.userId, displayName: typeof item.name === "string" ? item.name : undefined }] : [];
  }) : [];
  if (scheduledIdentities.length) return scheduledIdentities;

  const directory = await client.rpc("club_list_member_identities", { p_organisation_id: organisationId });
  return Array.isArray(directory.data) ? directory.data.flatMap((row: unknown) => {
    if (!row || typeof row !== "object") return [];
    const item = row as { user_id?: unknown; display_name?: unknown };
    return typeof item.user_id === "string" ? [{ userId: item.user_id, displayName: typeof item.display_name === "string" ? item.display_name : undefined }] : [];
  }) : [];
}
