/**
 * Glow Zone App Store review identity.
 * UI demonstration only: no membership, credits or staff permissions.
 */
export function isGlowZoneReviewer(
  user: {
    email?: string | null;
    email_confirmed_at?: string | null;
  } | null | undefined
): boolean {
  return (
    user?.email?.trim().toLowerCase() ===
      "preview.staff@r12.live"
  );
}
