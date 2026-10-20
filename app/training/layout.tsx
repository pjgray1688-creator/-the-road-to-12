import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { authenticatedServerClient } from "@/lib/require-user";
import { signInDestination } from "@/lib/training-entry";
import { TrainingStorageBoundary } from "@/components/training-storage-boundary";

export default async function TrainingLayout({ children }: { children: ReactNode }) {
  const { user } = await authenticatedServerClient();
  if (!user) redirect(signInDestination("/training"));
  return <TrainingStorageBoundary userId={user.id}>{children}</TrainingStorageBoundary>;
}
