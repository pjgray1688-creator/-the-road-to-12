import type { Metadata } from "next";
import { PrivacyPolicy } from "@/components/privacy-policy";

export const metadata: Metadata = { title: "R12 Coach Privacy Policy", description: "Privacy information for the R12 Coach app.", alternates: { canonical: "/coach/privacy" } };
export default function CoachPrivacyPage() { return <PrivacyPolicy app="coach" />; }
