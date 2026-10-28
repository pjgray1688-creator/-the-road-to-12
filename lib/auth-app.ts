export const authAppIds = ["training", "club", "coach", "glow"] as const;

export type AuthApp = (typeof authAppIds)[number];

export type AuthAppBrand = {
  id: AuthApp;
  name: string;
  eyebrow: string;
  markSrc: string;
  defaultReturnTo: string;
  registrationReturnTo: string;
  privacyPath: string;
  nativeScheme: string;
};

export const authApps: Record<AuthApp, AuthAppBrand> = {
  training: { id: "training", name: "R12 Training", eyebrow: "R12 TRAINING", markSrc: "/r12-app-assets/icon-192.png", defaultReturnTo: "/", registrationReturnTo: "/onboarding", privacyPath: "/privacy", nativeScheme: "r12-training" },
  club: { id: "club", name: "R12 Club", eyebrow: "R12 CLUB", markSrc: "/brand/r12-club-emblem.png", defaultReturnTo: "/club", registrationReturnTo: "/club", privacyPath: "/club/privacy", nativeScheme: "r12-club" },
  coach: { id: "coach", name: "R12 Coach", eyebrow: "R12 COACH", markSrc: "/r12-app-assets/coach-icon-192.png", defaultReturnTo: "/coach", registrationReturnTo: "/coach", privacyPath: "/coach/privacy", nativeScheme: "r12-coach" },
  glow: { id: "glow", name: "Glow Zone", eyebrow: "GLOW ZONE", markSrc: "/r12-app-assets/glow-zone-brand.png", defaultReturnTo: "/glow-zone", registrationReturnTo: "/glow-zone", privacyPath: "/glow-zone/privacy", nativeScheme: "r12-glowzone" },
};

export function parseAuthApp(value: string | null | undefined): AuthApp | undefined {
  return authAppIds.find(app => app === value);
}

export function appForReturnTo(next: string | undefined): AuthApp | undefined {
  if (!next) return undefined;
  if (next === "/glow-zone" || next.startsWith("/glow-zone/")) return "glow";
  if (next === "/coach" || next.startsWith("/coach/")) return "coach";
  if (next === "/club" || next.startsWith("/club/")) return "club";
  return undefined;
}

export function resolveAuthApp(input: { app?: string | null; privacyApp?: string | null; next?: string }): AuthApp {
  // The validated destination wins over presentational query parameters, so a
  // link cannot claim one product identity and continue into another product.
  return appForReturnTo(input.next) ?? parseAuthApp(input.app) ?? parseAuthApp(input.privacyApp) ?? "training";
}

export function returnToForApp(app: AuthApp, next: string | undefined, registration = false) {
  const destinationApp = appForReturnTo(next);
  if (next && (!destinationApp || destinationApp === app)) return next;
  return registration ? authApps[app].registrationReturnTo : authApps[app].defaultReturnTo;
}

export function authAccountHref(app: AuthApp, mode: "signIn" | "signUp" | "forgot", next?: string) {
  const params = new URLSearchParams({ app, mode });
  if (next) params.set("next", returnToForApp(app, next, mode === "signUp"));
  return `/account?${params.toString()}`;
}

export function nativeContinuationUrl(app: AuthApp) {
  const destination = authApps[app].defaultReturnTo;
  return `${authApps[app].nativeScheme}://${destination.replace(/^\//, "")}`;
}
