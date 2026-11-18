"use client";

import { AppShell, PageHeader } from "@/components/ui";
import { LoadRecovery } from "@/components/load-recovery";

export default function MemberHubError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <AppShell className="module-page member-hub-page member-area-page"><PageHeader title="Member Area"/><LoadRecovery app="Member Hub" kind="unavailable" reset={reset}/></AppShell>;
}
