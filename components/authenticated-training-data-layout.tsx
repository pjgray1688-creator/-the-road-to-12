import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { authenticatedServerClient } from "@/lib/require-user";
import { signInDestination } from "@/lib/training-entry";
import { TrainingStorageBoundary } from "@/components/training-storage-boundary";

export async function AuthenticatedTrainingDataLayout({ children, path }: { children: ReactNode; path: string }) {
  const { user } = await authenticatedServerClient();
  if (!user) redirect(signInDestination(path));
  return <TrainingStorageBoundary userId={user.id}>{children}</TrainingStorageBoundary>;
}
