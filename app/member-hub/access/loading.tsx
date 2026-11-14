import { AppShell, PageHeader, Surface } from "@/components/ui";

export default function MemberGymAccessLoading() {
  return <AppShell className="module-page member-hub-page member-area-page member-access-page" aria-busy="true">
    <PageHeader title="Gym Access" description="Loading your current access status…"/>
    <Surface className="member-hub-section member-access-skeleton">
      <span className="member-access-skeleton-line"/>
      <span className="member-access-skeleton-code"/>
      <span className="member-access-skeleton-line short"/>
    </Surface>
    <Surface className="member-hub-section"><span className="member-access-skeleton-line"/><span className="member-access-skeleton-line short"/></Surface>
  </AppShell>;
}
