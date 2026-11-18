export type LoadFailureKind = "session" | "permission" | "network" | "unavailable";

export function classifyLoadFailure(value: unknown): LoadFailureKind {
  const error = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const cause = error.cause && typeof error.cause === "object" ? error.cause as Record<string, unknown> : {};
  const providerCode = typeof error.supabaseCode === "string" ? error.supabaseCode : typeof error.code === "string" ? error.code : "";
  if (providerCode === "42501" || error.code === "FORBIDDEN") return "permission";
  if (["PGRST301", "PGRST303", "JWT_EXPIRED", "TOKEN_REFRESH_FAILED"].includes(providerCode)) return "session";
  const networkCode = typeof cause.code === "string" ? cause.code : typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";
  if (error.name === "AbortError" || error.name === "TypeError" || /fetch failed|network|timed? ?out|econnreset|enotfound|socket hang up/i.test(`${networkCode} ${message}`)) return "network";
  return "unavailable";
}

export function safeLoadFailureFields(value: unknown) {
  const error = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    kind: classifyLoadFailure(value),
    failureCode: typeof error.code === "string" ? error.code : undefined,
    supabaseCode: typeof error.supabaseCode === "string" ? error.supabaseCode : undefined,
    operation: typeof error.operation === "string" ? error.operation : undefined,
  };
}
