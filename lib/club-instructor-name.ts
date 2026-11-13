import type { SupabaseClient } from "@supabase/supabase-js";

export type LinkedInstructorIdentity = { userId?: string; assignmentId?: string; displayName?: string };

function readIdentities(value: unknown, key: "schedule" | "directory"): LinkedInstructorIdentity[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const userId = key === "schedule" ? item.userId ?? item.user_id : item.user_id ?? item.userId;
    const assignmentId = key === "schedule" ? item.assignmentId ?? item.assignment_id : undefined;
    const displayName = key === "schedule" ? item.name ?? item.display_name : item.display_name ?? item.name;
    if (typeof userId !== "string" && typeof assignmentId !== "string") return [];
    return [{ ...(typeof userId === "string" ? { userId } : {}), ...(typeof assignmentId === "string" ? { assignmentId } : {}), displayName: typeof displayName === "string" ? displayName.trim() || undefined : undefined }];
  });
}

function nameCompleteness(value?: string) {
  return value?.trim().split(/\s+/).filter(Boolean).length ?? 0;
}

/** Prefer the current linked R12 profile identity over a class-session snapshot. */
export function resolveInstructorName(hostUserId: string | null | undefined, assignmentId: string | null | undefined, identities: readonly LinkedInstructorIdentity[], sessionSnapshot?: string | null): string {
  const assignmentName = assignmentId ? identities.find(item => item.assignmentId === assignmentId)?.displayName?.trim() : undefined;
  if (hostUserId) {
    const identity = identities.find(item => item.userId === hostUserId);
    const linkedName = identity?.displayName?.trim();
    if (linkedName && nameCompleteness(linkedName) > 1) return linkedName;
    if (assignmentName && nameCompleteness(assignmentName) > 1) return assignmentName;
    return "Instructor name unavailable";
  }
  if (assignmentName) return assignmentName;
  const snapshot = sessionSnapshot?.trim();
  return snapshot && nameCompleteness(snapshot) > 1 ? snapshot : "Instructor name unavailable";
}

/** Read linked staff names through the existing authorised Club RPCs. */
export async function listLinkedInstructorIdentities(client: SupabaseClient, organisationId: string): Promise<LinkedInstructorIdentity[]> {
  const [scheduled, directory, instructors] = await Promise.all([
    client.rpc("club_list_schedule_staff", { p_organisation_id: organisationId }),
    client.rpc("club_list_member_identities", { p_organisation_id: organisationId }),
    client.rpc("club_list_class_instructor_identities", { p_organisation_id: organisationId }),
  ]);
  const merged = new Map<string, LinkedInstructorIdentity>();
  for (const identity of [...readIdentities(scheduled.data, "schedule"), ...readIdentities(instructors.data, "schedule")]) {
    const key = identity.userId ? `user:${identity.userId}` : `assignment:${identity.assignmentId}`;
    merged.set(key, identity);
  }
  for (const identity of readIdentities(directory.data, "directory")) {
    const key = `user:${identity.userId}`;
    const current = merged.get(key);
    if (!current || nameCompleteness(identity.displayName) > nameCompleteness(current.displayName)) merged.set(key, identity);
  }
  return [...merged.values()];
}
