export type AppBaseUrlStatus = { status: "configured" | "missing" | "invalid"; source: "R12_APP_BASE_URL" | "NEXT_PUBLIC_SITE_URL" | "VERCEL_URL" | "fallback"; effectiveUrl: string; detail?: string };

const productionFallback = "https://the-road-to-12.vercel.app";
const invalidAppHosts = new Set(["www.r12.live"]);

export function appBaseUrlStatus(env: NodeJS.ProcessEnv = process.env): AppBaseUrlStatus {
  // Per-deployment Vercel Preview URL is the correct origin for checkout
  // return links. Never let inherited production site URL settings redirect a
  // Preview customer's return to the production application.
  const previewDeployment = env.VERCEL_ENV === "preview" ? env.VERCEL_URL?.trim() : undefined;
  if (previewDeployment) {
    if (!/^[A-Za-z0-9.-]+$/.test(previewDeployment)) {
      return { status: "invalid", source: "VERCEL_URL", effectiveUrl: "https://invalid.invalid", detail: "Vercel Preview URL is invalid." };
    }
    return { status: "configured", source: "VERCEL_URL", effectiveUrl: `https://${previewDeployment}` };
  }
  const first = env.R12_APP_BASE_URL?.trim();
  const second = env.NEXT_PUBLIC_SITE_URL?.trim();
  const configured = first || second;
  const source = first ? "R12_APP_BASE_URL" : second ? "NEXT_PUBLIC_SITE_URL" : "fallback";
  const fallback = env.NODE_ENV === "development" ? "http://localhost:3000" : productionFallback;
  if (!configured) return { status: "missing", source, effectiveUrl: fallback, detail: "Using the safe application URL fallback." };
  try {
    const url = new URL(configured);
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "") || invalidAppHosts.has(url.hostname.toLowerCase())) {
      return { status: "invalid", source, effectiveUrl: fallback, detail: "Use the R12 application origin without a path, query or fragment. The r12.live origin is valid once its application routes are proxied." };
    }
    return { status: "configured", source: source as "R12_APP_BASE_URL" | "NEXT_PUBLIC_SITE_URL", effectiveUrl: url.origin };
  } catch {
    return { status: "invalid", source, effectiveUrl: fallback, detail: "The configured application URL is not a valid HTTP(S) origin." };
  }
}

export function siteUrl() {
  return appBaseUrlStatus().effectiveUrl;
}
