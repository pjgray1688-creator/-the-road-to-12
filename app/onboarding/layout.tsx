import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { TrainingStorageBoundary } from "@/components/training-storage-boundary";
import { authenticatedServerClient } from "@/lib/require-user";
import { signInDestination } from "@/lib/training-entry";

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const { user } = await authenticatedServerClient();
  if (!user) redirect(signInDestination("/onboarding"));
  return <TrainingStorageBoundary userId={user.id}>{children}</TrainingStorageBoundary>;
}
