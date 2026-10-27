import type { User } from "@supabase/supabase-js";

export type PrivacyOperator = { id: string; name: string; email: string };

function configuredOperators(): Map<string, string> {
  const raw = process.env.R12_PRIVACY_OPERATOR_ALLOWLIST;
  if (!raw) return new Map();
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || Array.isArray(value) || typeof value !== "object") return new Map();
    return new Map(Object.entries(value).flatMap(([id, name]) =>
      /^[0-9a-f-]{36}$/i.test(id) && typeof name === "string" && name.trim().length >= 2
        ? [[id, name.trim()]] : []));
  } catch {
    return new Map();
  }
}

/** A UUID-only list is intentionally insufficient: audit evidence needs a named person. */
export function privacyOperatorFromUser(user: User | null): PrivacyOperator | null {
  if (!user?.email) return null;
  const name = configuredOperators().get(user.id);
  return name ? { id: user.id, name, email: user.email } : null;
}

