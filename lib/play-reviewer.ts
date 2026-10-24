const PLAY_REVIEWER_EMAIL = "staff@r12.live";

export function isPlayReviewerEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === PLAY_REVIEWER_EMAIL;
}

/** Only the published policy is public; operational Club routes retain their gates. */
export function isPublicClubPrivacyRequest(pathname: string, method: string): boolean {
  return pathname === "/club/privacy" && (method === "GET" || method === "HEAD");
}

export function playReviewerClubRequestPolicy(email: string | null | undefined, pathname: string, method: string): "allow" | "demo" | "deny" {
  if (isPublicClubPrivacyRequest(pathname, method)) return "allow";
  if (!isPlayReviewerEmail(email)) return "allow";
  if (pathname === "/api/club" || pathname.startsWith("/api/club/")) return "deny";
  if (pathname === "/club" || pathname.startsWith("/club/")) {
    if (method !== "GET" && method !== "HEAD") return "deny";
    if (pathname === "/club/manifest.webmanifest" || pathname === "/club/reviewer" || pathname.startsWith("/club/reviewer/")) return "allow";
    return "demo";
  }
  return "allow";
}

/** The Play reviewer is an app-only demo identity, never a Club role. */
export function hasPlayReviewerEntitlement(user: { email?: string | null; email_confirmed_at?: string | null } | null | undefined): boolean {
  return isPlayReviewerEmail(user?.email) && Boolean(user?.email_confirmed_at);
}
