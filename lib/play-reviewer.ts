const PLAY_REVIEWER_EMAIL = "staff@r12.live";

/** The Play reviewer is an app-only demo identity, never a Club role. */
export function hasPlayReviewerEntitlement(user: { email?: string | null; email_confirmed_at?: string | null } | null | undefined): boolean {
  return user?.email?.trim().toLowerCase() === PLAY_REVIEWER_EMAIL && Boolean(user.email_confirmed_at);
}
