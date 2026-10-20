import type { ReactNode } from "react";
import { AuthenticatedTrainingDataLayout } from "@/components/authenticated-training-data-layout";
export default function HistoryLayout({ children }: { children: ReactNode }) { return <AuthenticatedTrainingDataLayout path="/history">{children}</AuthenticatedTrainingDataLayout>; }
