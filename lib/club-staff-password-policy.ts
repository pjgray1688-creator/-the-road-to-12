export type ClubPasswordRole = "owner" | "gym_admin" | "gym_staff" | "trainer" | string;

// These immutable Auth identities are the only Madhouse accounts authorized
// for manager-initiated password changes. Names and emails are not authority.
export const PETER_AUTH_USER_ID = "db8c0932-ec65-40c7-b054-05b820078e5c";
export const KEENAN_AUTH_USER_ID = "97e7b69f-ce77-4256-8f4c-5ed77b4a7e84";

const directPasswordManagers = new Set([PETER_AUTH_USER_ID, KEENAN_AUTH_USER_ID]);

export function isDirectPasswordManager(userId: string) {
  return directPasswordManagers.has(userId.toLowerCase());
}

/** Peter's explicit exception permits changing Keenan's owner account only. */
export function canManagerChangeStaffPassword(
  actorUserId: string,
  actorRole: ClubPasswordRole,
  targetUserId: string,
  targetRole: ClubPasswordRole,
) {
  const actor = actorUserId.toLowerCase();
  const target = targetUserId.toLowerCase();
  if (!isDirectPasswordManager(actor) || !target || actor === target) return false;
  if (!["owner", "gym_admin"].includes(actorRole)) return false;
  if (["gym_staff", "trainer"].includes(targetRole)) return true;
  if (targetRole === "gym_admin") return actorRole === "owner";
  return actor === PETER_AUTH_USER_ID && target === KEENAN_AUTH_USER_ID && targetRole === "owner";
}
