export default function CoachLoading() {
  return <main className="coach-shell route-loading coach-route-loading" aria-busy="true">
    <h1 className="coach-visually-hidden">Coach</h1>
    <div className="route-loading-body" role="status" aria-label="Loading Coach"><span className="route-loading-sr">Loading Coach</span><i/><i/><i/></div>
  </main>;
}
