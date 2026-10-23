import { AppShell, PageHeader, Surface } from "@/components/ui";

export default function ClubClassesLoading() {
  return <AppShell className="module-page club-classes-page"><PageHeader title="Timetable" description="Loading the organisation schedule." /><Surface><p className="muted" role="status">Loading classes…</p></Surface></AppShell>;
}
