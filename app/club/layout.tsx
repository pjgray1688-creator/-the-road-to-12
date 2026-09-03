import type { Metadata } from "next";

export const metadata: Metadata = { title: { default: "R12 Club", template: "%s · R12 Club" }, description: "Operational tools for R12 clubs.", manifest: "/club/manifest.webmanifest" };

export default function ClubLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }
