import type { Metadata } from "next";
import { PrivacyPolicy } from "@/components/privacy-policy";

export const metadata: Metadata = { title: "R12 Training Privacy Policy", description: "Privacy information for the R12 Training app.", alternates: { canonical: "/privacy" } };
export default function PrivacyPage() { return <PrivacyPolicy app="training" />; }
