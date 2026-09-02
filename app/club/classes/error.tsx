"use client";

import { AppNav } from "@/components/app-nav";
import { AppShell, BackButton, EmptyState, PageHeader } from "@/components/ui";

export default function ClubClassesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <AppShell className="module-page club-classes-page"><PageHeader eyebrow="R12 CLUB" title="Classes" description="Timetable and class management." /><EmptyState title="Classes couldn’t be loaded.">Try again shortly. No class information has been changed.</EmptyState><button type="button" className="secondary full" onClick={reset}>Try again</button><BackButton href="/club">Back to Club</BackButton><AppNav /></AppShell>;
}
