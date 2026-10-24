import type { Metadata } from "next";
import { ClubPrivacyPolicy } from "@/components/club-privacy-policy";

export const metadata: Metadata = { title: "R12 Club Privacy Policy", description: "Privacy information for R12 Club, gym operations and connected account services.", alternates: { canonical: "/club/privacy" } };
export default function ClubPrivacyPage() { return <ClubPrivacyPolicy />; }
