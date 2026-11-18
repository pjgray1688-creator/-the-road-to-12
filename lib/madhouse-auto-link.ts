type LinkRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

type AuthIdentity = { email_confirmed_at?: string | null };

export async function autoLinkVerifiedMadhouseMember(
  client: LinkRpcClient,
  organisation: { slug?: string | null } | undefined,
  user: AuthIdentity,
) {
  if (organisation && organisation.slug !== "madhouse-gym") return "not_applicable";
  if (!user.email_confirmed_at) return "email_verification_required";
  try {
    const result = await client.rpc("club_auto_link_verified_imported_member", {});
    if (result.error || !result.data || typeof result.data !== "object") return "unavailable";
    const state = (result.data as { state?: unknown }).state;
    return typeof state === "string" ? state : "unavailable";
  } catch {
    // The page remains usable during staged deployment before the SQL is applied.
    return "unavailable";
  }
}
