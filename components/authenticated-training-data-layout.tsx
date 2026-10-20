import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { TrainingStorageBoundary } from "@/components/training-storage-boundary";
import { authenticatedServerClient } from "@/lib/require-user";
import { signInDestination } from "@/lib/training-entry";

export async function AuthenticatedTrainingDataLayout({ children, path }: { children: ReactNode; path: string }) {
  const { user } = await authenticatedServerClient();
  if (!user) redirect(signInDestination(path));
  return <TrainingStorageBoundary userId={user.id}>{children}</TrainingStorageBoundary>;
}
