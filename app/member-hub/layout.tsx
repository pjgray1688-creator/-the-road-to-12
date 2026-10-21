import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppNav } from "@/components/app-nav";

export const metadata: Metadata = {
  title: { default: "R12 Member Area", template: "%s · R12 Member Area" },
  description: "Membership, access, classes and club services for R12 members.",
  manifest: "/member-hub/manifest.webmanifest",
};

export default function MemberHubLayout({ children }: { children: ReactNode }) {
  return <>{children}<AppNav /></>;
}
