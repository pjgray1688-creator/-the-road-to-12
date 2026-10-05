export type ProgrammeRelationship = "primary" | "cover";

/**
 * Programme design belongs to the primary PT. Cover PT access is limited to
 * the read-only plan and session-scoped logging handled by Coach APIs.
 *
 * Database/RPC authorization remains authoritative; this pure policy keeps
 * application boundaries and regression tests explicit.
 */
export function canPersistProgrammeChanges(input: {
  relationship: ProgrammeRelationship;
  coachUserId: string;
  programmeOwnerUserId: string;
}) {
  return input.relationship === "primary" && input.coachUserId === input.programmeOwnerUserId;
}
