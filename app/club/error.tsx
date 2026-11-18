"use client";

import { AppShell, PageHeader } from "@/components/ui";
import { LoadRecovery } from "@/components/load-recovery";

export default function ClubError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <AppShell className="module-page club-page"><PageHeader eyebrow="R12 CLUB" title="Club" description="Operational workspace."/><LoadRecovery app="Club" kind="unavailable" reset={reset}/></AppShell>;
}
