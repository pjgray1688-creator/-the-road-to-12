type LinkedIdentity = { userId: string; displayName?: string };

/** Prefer the current linked R12 profile identity over a class-session snapshot. */
export function resolveInstructorName(hostUserId: string | null | undefined, identities: readonly LinkedIdentity[], sessionSnapshot?: string | null): string {
  if (hostUserId) {
    const identity = identities.find(item => item.userId === hostUserId);
    if (identity) return identity.displayName?.trim() || "Instructor name unavailable";
  }
  return sessionSnapshot?.trim() || "Instructor not assigned";
}
