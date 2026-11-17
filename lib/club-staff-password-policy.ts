export type PasswordResetRole = "owner" | "gym_admin" | "gym_staff" | "trainer" | string;

/** Management may reset only lower-privilege Club accounts, never an owner or themselves. */
export function canManagerResetStaffPassword(actorRole: PasswordResetRole, targetRole: PasswordResetRole, actorUserId: string, targetUserId: string) {
  if (!actorUserId || !targetUserId || actorUserId === targetUserId) return false;
  if (!["gym_staff", "trainer", "gym_admin"].includes(targetRole)) return false;
  if (actorRole === "owner") return true;
  return actorRole === "gym_admin" && ["gym_staff", "trainer"].includes(targetRole);
}
