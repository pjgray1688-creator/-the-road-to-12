import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return { name: "R12 Club", short_name: "R12 Club", description: "Operational tools for R12 clubs.", start_url: "/club", display: "standalone", background_color: "#070a0d", theme_color: "#070a0d", icons: [{ src: "/icons/club-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/icons/club-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }] };
}
