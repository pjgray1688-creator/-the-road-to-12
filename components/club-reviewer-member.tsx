import { Surface } from "@/components/ui";
import { reviewerClubMembers } from "@/lib/play-reviewer-club-data";

export function ClubReviewerMember({ memberId, unlinked = false }: { memberId?: string; unlinked?: boolean }) {
  const member = reviewerClubMembers.find(item => item.userId === memberId) ?? reviewerClubMembers[0];
  return <Surface><span className="eyebrow">SYNTHETIC {unlinked ? "CUSTOMER" : "MEMBER"} RECORD</span><h2>{unlinked ? "Jamie Parker" : member.displayName}</h2><div className="club-detail-list"><div className="club-detail-row"><span>Membership</span><strong>{unlinked ? "No membership linked" : member.membershipName}</strong></div><div className="club-detail-row"><span>Status</span><strong>{unlinked ? "Account not linked · demo" : member.membershipStatus === "active" ? "Active · demo" : "Needs attention · demo"}</strong></div><div className="club-detail-row"><span>Home venue</span><strong>{unlinked ? "Not set" : member.homeLocation?.name}</strong></div><div className="club-detail-row"><span>Gym access</span><strong>{unlinked ? "Not available" : member.accessState === "active" ? "Example active state" : "Example review state"}</strong></div></div><p className="muted">This synthetic record cannot be edited and does not grant gym access.</p></Surface>;
}
