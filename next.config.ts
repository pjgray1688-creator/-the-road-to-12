import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "16mb" } },
  async rewrites() { return [{ source: "/.well-known/assetlinks.json", destination: "/api/android/assetlinks" }]; },
};
export default nextConfig;
