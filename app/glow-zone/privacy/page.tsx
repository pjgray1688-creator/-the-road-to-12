import type { Metadata } from "next";
import { PrivacyPolicy } from "@/components/privacy-policy";

export const metadata: Metadata = { title: "Glow Zone Privacy Policy", description: "Privacy information for the Glow Zone app.", alternates: { canonical: "/glow-zone/privacy" } };
export default function GlowPrivacyPage() { return <PrivacyPolicy app="glow" />; }
