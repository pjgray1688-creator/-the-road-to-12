export const R12_APP_ORIGIN = "https://app.r12.live";
export const JOIN_SMART_QR_URL = `${R12_APP_ORIGIN}/go/join`;
export const MADHOUSE_JOINING_DESTINATION = "https://secure.clubmanagercentral.com/acd47283-1392-4c40-8d63-a908ba7d46d3/Joining.mvc";

export const APP_DOWNLOAD_LINKS = {
  training: {
    name: "R12 Training",
    qrPath: "/go/training",
    appPath: "/training",
    apple: "https://apps.apple.com/us/app/r12/id6826376621",
    googlePlay: "https://play.google.com/store/apps/details?id=live.r12.training",
  },
  club: {
    name: "R12 Club",
    qrPath: "/go/club",
    appPath: "/club",
    apple: "https://apps.apple.com/us/app/r12-club/id6826550359",
    googlePlay: "https://play.google.com/store/apps/details?id=live.r12.club",
  },
  coach: {
    name: "R12 Coach",
    qrPath: "/go/coach",
    appPath: "/coach",
    apple: "https://apps.apple.com/us/app/r12-coach/id6826687128",
    googlePlay: "https://play.google.com/store/apps/details?id=live.r12.coach",
  },
  "glow-zone": {
    name: "Glow Zone",
    qrPath: "/go/glow-zone",
    appPath: "/glow-zone",
    apple: "https://apps.apple.com/us/app/glow-zone/id6826693241",
    googlePlay: "https://play.google.com/store/apps/details?id=live.r12.glowzone",
  },
} as const;

export type AppDownloadSlug = keyof typeof APP_DOWNLOAD_LINKS;
export type DownloadPlatform = "ios" | "android" | "desktop" | "unknown";

export const PERMANENT_QR_DESTINATIONS = Object.fromEntries(
  Object.entries(APP_DOWNLOAD_LINKS).map(([slug, app]) => [slug, `${R12_APP_ORIGIN}${app.qrPath}`]),
) as Record<AppDownloadSlug, string>;

export function isAppDownloadSlug(value: string): value is AppDownloadSlug {
  return Object.prototype.hasOwnProperty.call(APP_DOWNLOAD_LINKS, value);
}

export function detectDownloadPlatform(userAgent: string | null | undefined): DownloadPlatform {
  if (!userAgent) return "unknown";
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent))) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  if (/Windows|Macintosh|Mac OS X|Linux|X11/i.test(userAgent)) return "desktop";
  return "unknown";
}

export function appOpenUrl(slug: AppDownloadSlug): string {
  return `${R12_APP_ORIGIN}${APP_DOWNLOAD_LINKS[slug].appPath}`;
}
