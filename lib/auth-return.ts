export function safeInternalReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined;
  return value;
}

export function authCallbackUrl(origin: string, next: string | null | undefined) {
  const destination = safeInternalReturnTo(next) ?? "/onboarding";
  return `${origin}/auth/callback?next=${encodeURIComponent(destination)}`;
}

export function staffClaimReturnTo(grant: string | null | undefined) {
  if (!grant || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(grant)) return "/club/staff/claim";
  return `/club/staff/claim?grant=${encodeURIComponent(grant)}`;
}
