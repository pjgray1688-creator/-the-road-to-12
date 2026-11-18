"use client";

import { LoadRecovery } from "@/components/load-recovery";

export default function CoachError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="shell"><LoadRecovery app="Coach" kind="unavailable" reset={reset}/></main>;
}
