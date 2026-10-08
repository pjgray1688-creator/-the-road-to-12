export function siteUrl() {
  const configured = process.env.R12_APP_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  const fallback = process.env.NODE_ENV === "production" ? "https://the-road-to-12.vercel.app" : "http://localhost:3000";
  const value = (configured || fallback).replace(/\/+$/, "");
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("R12 app URL must use HTTP or HTTPS");
  return url.toString().replace(/\/$/, "");
}
