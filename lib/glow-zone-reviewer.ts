/**
 * Glow Zone App Store review identities.
 * UI demonstration only: no membership, credits or staff permissions.
 */
const GLOW_ZONE_REVIEWER_EMAILS = new Set([
  "appreview.staff@r12.live",
  "preview.staff@r12.live",
]);

export function isGlowZoneReviewer(
  user:
    | {
        email?: string | null;
        email_confirmed_at?: string | null;
      }
    | null
    | undefined
): boolean {
  const email = user?.email?.trim().toLowerCase();
  return !!email && GLOW_ZONE_REVIEWER_EMAILS.has(email);
}
