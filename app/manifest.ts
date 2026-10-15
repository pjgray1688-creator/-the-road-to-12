import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "R12", short_name: "R12", description: "Training coach and workout log.", start_url: "/member-hub", display: "standalone", background_color: "#070a0d", theme_color: "#070a0d", icons: [{ src: "/r12-app-assets/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/r12-app-assets/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }] };
}
