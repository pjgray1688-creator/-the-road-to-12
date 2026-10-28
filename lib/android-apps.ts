import type { MetadataRoute } from "next";

export const ANDROID_HOST = "app.r12.live";

export const ANDROID_APPS = {
  r12: { packageId: "live.r12.training", name: "R12", shortName: "R12", description: "Adaptive training, recovery and progress tracking.", startUrl: "/training", scope: "/", deepLinkPath: "/training", manifestPath: "/manifest.webmanifest", icon192: "/r12-app-assets/icon-192.png", icon512: "/r12-app-assets/icon-512.png", themeColor: "#070a0d" },
  club: { packageId: "live.r12.club", name: "R12 Club", shortName: "R12 Club", description: "Staff reception and operations for R12 clubs.", startUrl: "/club/reception", scope: "/club/", deepLinkPath: "/club", manifestPath: "/club/manifest.webmanifest", icon192: "/r12-app-assets/club-icon-192.png", icon512: "/r12-app-assets/club-icon-512.png", themeColor: "#070a0d" },
  coach: { packageId: "live.r12.coach", name: "R12 Coach", shortName: "R12 Coach", description: "Programming, check-ins and client progress for R12 coaches.", startUrl: "/coach", scope: "/", deepLinkPath: "/coach", manifestPath: "/coach/manifest.webmanifest", icon192: "/r12-app-assets/coach-icon-192.png", icon512: "/r12-app-assets/coach-icon-512.png", themeColor: "#07100a" },
  glowZone: { packageId: "live.r12.glowzone", name: "Glow Zone", shortName: "Glow Zone", description: "Minute balances, activity and safety information for Glow Zone Carlton customers.", startUrl: "/glow-zone", scope: "/", deepLinkPath: "/glow-zone", manifestPath: "/glow-zone/manifest.webmanifest", icon192: "/r12-app-assets/glow-zone-icon-192.png", icon512: "/r12-app-assets/glow-zone-icon-512.png", themeColor: "#07100d" },
} as const;

export type AndroidAppKey = keyof typeof ANDROID_APPS;

export function webManifest(key: AndroidAppKey): MetadataRoute.Manifest {
  const app = ANDROID_APPS[key];
  return { id: `/android/${key}`, name: app.name, short_name: app.shortName, description: app.description, start_url: app.startUrl, scope: app.scope, display: "standalone", background_color: "#070a0d", theme_color: app.themeColor, icons: [{ src: app.icon192, sizes: "192x192", type: "image/png", purpose: "any" }, { src: app.icon512, sizes: "512x512", type: "image/png", purpose: "any" }, { src: app.icon512, sizes: "512x512", type: "image/png", purpose: "maskable" }] };
}

const sha256Fingerprint = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export function androidAssetLinks(value: string | undefined) {
  if (!value) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return []; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const configured = parsed as Record<string, unknown>;
  return Object.values(ANDROID_APPS).flatMap(app => {
    const fingerprints = configured[app.packageId];
    if (!Array.isArray(fingerprints)) return [];
    const valid = [...new Set(fingerprints.filter((item): item is string => typeof item === "string" && sha256Fingerprint.test(item)))];
    return valid.length ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: app.packageId, sha256_cert_fingerprints: valid } }] : [];
  });
}

export function manifestResponse(key: AndroidAppKey) {
  return new Response(JSON.stringify(webManifest(key)), { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=300" } });
}
