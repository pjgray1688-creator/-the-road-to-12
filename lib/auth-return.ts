import { authApps, resolveAuthApp, returnToForApp, type AuthApp } from "@/lib/auth-app";

export function safeInternalReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined;
  return value;
}

export function authCallbackUrl(origin: string, next: string | null | undefined, requestedApp?: string | null) {
  const safeNext = safeInternalReturnTo(next);
  const app = resolveAuthApp({ app: requestedApp, next: safeNext });
  const destination = returnToForApp(app, safeNext, true);
  const params = new URLSearchParams({ app, next: destination });
  return `${origin}/auth/callback?${params.toString()}`;
}

export function authDestination(input: { app?: string | null; privacyApp?: string | null; next?: string | null }, registration = false): { app: AuthApp; next: string } {
  const safeNext = safeInternalReturnTo(input.next);
  const app = resolveAuthApp({ app: input.app, privacyApp: input.privacyApp, next: safeNext });
  return { app, next: returnToForApp(app, safeNext, registration) };
}

export function authFallbackFor(app: AuthApp, registration = false) {
  return registration ? authApps[app].registrationReturnTo : authApps[app].defaultReturnTo;
}

export function staffClaimReturnTo(grant: string | null | undefined) {
  if (!grant || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(grant)) return "/club/staff/claim";
  return `/club/staff/claim?grant=${encodeURIComponent(grant)}`;
}
