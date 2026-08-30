export function siteUrl() { return process.env.NEXT_PUBLIC_SITE_URL || (process.env.NODE_ENV === "production" ? "https://the-road-to-12.vercel.app" : "http://localhost:3000"); }
