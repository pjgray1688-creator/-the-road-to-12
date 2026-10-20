import type { Metadata } from "next";
import { PrivacyPolicy } from "@/components/privacy-policy";

export const metadata: Metadata = { title: "R12 Club Privacy Policy", description: "Privacy information for the R12 Club app.", alternates: { canonical: "/club/privacy" } };
export default function ClubPrivacyPage() { return <PrivacyPolicy app="club" />; }
