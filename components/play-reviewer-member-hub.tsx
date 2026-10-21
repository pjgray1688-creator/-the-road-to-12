import { AppShell, PageHeader, Surface } from "@/components/ui";

/** Synthetic, read-only membership presentation. Contains no real member or access data. */
export function PlayReviewerMemberHub() {
  return <AppShell className="module-page member-hub-page member-area-page">
    <PageHeader eyebrow="AUTHORISED PLAY REVIEW" title="Member Area" description="A demonstration membership for app review." />
    <Surface className="member-hub-section">
      <span className="eyebrow">DEMO MEMBERSHIP · NO GYM ACCESS</span>
      <h2>R12 Training Demo</h2>
      <p>This sample screen demonstrates the member experience. It is not a paid membership and does not grant entry to any gym.</p>
      <div className="club-detail-row"><span>Membership status</span><strong>Demo only</strong></div>
      <div className="club-detail-row"><span>Billing</span><strong>No charges or subscription</strong></div>
      <div className="club-detail-row"><span>Door access</span><strong>Not enabled</strong></div>
    </Surface>
    <Surface className="member-hub-section">
      <span className="eyebrow">MEMBER FEATURES</span>
      <div className="club-detail-row"><span>Training plans and workout logging</span><strong>Available in Training</strong></div>
      <div className="club-detail-row"><span>Exercise history and progress</span><strong>Available in Training</strong></div>
      <div className="club-detail-row"><span>Classes, shop and Glow Zone</span><strong>Demonstration only</strong></div>
      <p className="muted">No real customer records, payment methods, purchases, bookings, access credentials or staff controls are shown to this reviewer entitlement.</p>
    </Surface>
  </AppShell>;
}
