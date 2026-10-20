import type { ReactNode } from "react";
import { AuthenticatedTrainingDataLayout } from "@/components/authenticated-training-data-layout";
export default function ProgressLayout({ children }: { children: ReactNode }) { return <AuthenticatedTrainingDataLayout path="/progress">{children}</AuthenticatedTrainingDataLayout>; }
