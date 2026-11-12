import type { SupabaseClient } from "@supabase/supabase-js";

type LinkedIdentity = { userId: string; displayName?: string };

function readIdentities(value: unknown, key: "schedule" | "directory"): LinkedIdentity[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const userId = key === "schedule" ? item.userId ?? item.user_id : item.user_id ?? item.userId;
    const displayName = key === "schedule" ? item.name ?? item.display_name : item.display_name ?? item.name;
    return typeof userId === "string" ? [{ userId, displayName: typeof displayName === "string" ? displayName : undefined }] : [];
  });
}

function nameCompleteness(value?: string) {
  return value?.trim().split(/\s+/).filter(Boolean).length ?? 0;
}

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
  const [scheduled, directory] = await Promise.all([
    client.rpc("club_list_schedule_staff", { p_organisation_id: organisationId }),
    client.rpc("club_list_member_identities", { p_organisation_id: organisationId }),
  ]);
  const merged = new Map<string, LinkedIdentity>();
  for (const identity of readIdentities(scheduled.data, "schedule")) merged.set(identity.userId, identity);
  for (const identity of readIdentities(directory.data, "directory")) {
    const current = merged.get(identity.userId);
    if (!current || nameCompleteness(identity.displayName) > nameCompleteness(current.displayName)) merged.set(identity.userId, identity);
  }
  return [...merged.values()];
}
