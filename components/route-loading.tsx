import { AppShell, PageHeader } from "@/components/ui";

export function RouteLoading({ app, title, className = "" }: { app: string; title: string; className?: string }) {
  return <AppShell className={`route-loading ${className}`} aria-busy="true">
    <PageHeader title={title} description={`Loading ${app}…`}/>
    <div className="route-loading-body" role="status" aria-label={`Loading ${app}`}>
      <span className="route-loading-sr">Loading {app}</span>
      <i/><i/><i/>
    </div>
  </AppShell>;
}
