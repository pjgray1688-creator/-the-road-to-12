import type { MetadataRoute } from "next";import { webManifest } from "@/lib/android-apps";export default function manifest():MetadataRoute.Manifest{return webManifest("glowZone");}
