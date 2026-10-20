import type { ReactNode } from "react";
import { AuthenticatedTrainingDataLayout } from "@/components/authenticated-training-data-layout";
export default function PersonalBestsLayout({ children }: { children: ReactNode }) { return <AuthenticatedTrainingDataLayout path="/personal-bests">{children}</AuthenticatedTrainingDataLayout>; }
