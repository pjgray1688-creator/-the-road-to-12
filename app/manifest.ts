import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "THE ROAD TO 12%", short_name: "Road to 12%", description: "Training coach and workout log.", start_url: "/", display: "standalone", background_color: "#070a0d", theme_color: "#070a0d", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] };
}
