import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AuthCodeSession =
  | { ok: true; redirectType: string | null; user: User }
  | { ok: false };

/** Exchanges one PKCE code and validates the resulting identity against Auth. */
export async function exchangeAuthCodeSession(client: SupabaseClient, href: string): Promise<AuthCodeSession> {
  const url = new URL(href);
  if (url.searchParams.has("error") || url.hash.includes("error=")) return { ok: false };
  const code = url.searchParams.get("code");
  if (!code) return { ok: false };
  const flowId = url.searchParams.get("sb_flow_id") ?? undefined;
  try {
    const response = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
    const data = response.data as typeof response.data & { redirectType?: string | null };
    const { error } = response;
    if (error || !data.session?.user) return { ok: false };
    const verified = await client.auth.getUser();
    if (verified.error || !verified.data.user || verified.data.user.id !== data.session.user.id) return { ok: false };
    return { ok: true, redirectType: data.redirectType ?? null, user: verified.data.user };
  } catch {
    return { ok: false };
  }
}

export async function exchangePasswordRecoverySession(client: SupabaseClient, href: string) {
  const result = await exchangeAuthCodeSession(client, href);
  return result.ok && result.redirectType === "recovery" ? result : { ok: false as const };
}

/** Verifies one recovery OTP only after the account holder explicitly continues. */
export async function verifyPasswordRecoveryToken(client: SupabaseClient, tokenHash: string, type: string | null) {
  if (type !== "recovery" || !tokenHash) return { ok: false as const };
  try {
    const response = await client.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    if (response.error || !response.data.session?.user) return { ok: false as const };
    const verified = await client.auth.getUser();
    if (verified.error || !verified.data.user || verified.data.user.id !== response.data.session.user.id) return { ok: false as const };
    return { ok: true as const, user: verified.data.user };
  } catch {
    return { ok: false as const };
  }
}

export type PasswordRecoveryLink =
  | { kind: "token"; tokenHash: string; type: string | null }
  | { kind: "pkce" }
  | { kind: "invalid" };

/** Reads recovery credentials from the URL without contacting Supabase. */
export function passwordRecoveryLink(href: string): PasswordRecoveryLink {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const tokenHash = fragment.get("token_hash") ?? url.searchParams.get("token_hash");
  const type = fragment.get("type") ?? url.searchParams.get("type");
  if (tokenHash) return { kind: "token", tokenHash, type };
  if (url.searchParams.get("code")) return { kind: "pkce" };
  return { kind: "invalid" };
}

/** Removes one-time credentials from browser history after the single exchange attempt. */
export function authReturnUrlWithoutCredentials(href: string) {
  const url = new URL(href);
  url.searchParams.delete("code");
  url.searchParams.delete("sb_flow_id");
  url.searchParams.delete("token_hash");
  url.searchParams.delete("type");
  url.hash = "";
  return `${url.pathname}${url.search}`;
}
