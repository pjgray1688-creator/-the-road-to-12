import type { ClubClassType, ClubClassSession } from "@/lib/club-operations";
import type { ClubMemberSummaryRead } from "@/lib/club-operational";
import { REVIEWER_ORG_ID, REVIEWER_LOCATION_ID, REVIEWER_ROTHERHAM_LOCATION_ID, REVIEWER_CARLTON_LOCATION_ID, reviewerProducts, reviewerSessions } from "@/lib/play-reviewer-member-data";

export const reviewerClubOrganisation = { id: REVIEWER_ORG_ID, name: "Madhouse Gym", slug: "madhouse", active: true } as const;
export const reviewerClubLocations = [
  { id: REVIEWER_ROTHERHAM_LOCATION_ID, organisationId: REVIEWER_ORG_ID, name: "Rotherham", active: true },
  { id: REVIEWER_CARLTON_LOCATION_ID, organisationId: REVIEWER_ORG_ID, name: "Carlton", active: true },
];
export const reviewerClubRole = "gym_staff" as const;
export const reviewerClubUserId = "synthetic-club-reviewer";

export const reviewerClubMembers: ClubMemberSummaryRead[] = [
  { id: "demo-member-active", organisationId: REVIEWER_ORG_ID, userId: "demo-member-active", role: "member", active: true, displayName: "Alex Morgan", email: "alex.morgan@example.test", membershipName: "Madhouse Gym Membership", membershipStatus: "active", homeLocation: { id: REVIEWER_CARLTON_LOCATION_ID, name: "Carlton" }, accessState: "active" },
  { id: "demo-member-attention", organisationId: REVIEWER_ORG_ID, userId: "demo-member-attention", role: "member", active: true, displayName: "Sam Taylor", email: "sam.taylor@example.test", membershipName: "Madhouse Gym Membership", membershipStatus: "needs_attention", homeLocation: { id: REVIEWER_ROTHERHAM_LOCATION_ID, name: "Rotherham" }, accessState: "needs_attention" },
];
export const reviewerClubCustomers = [{ id: "demo-customer-unlinked", displayName: "Jamie Parker", email: "jamie.parker@example.test" }];

const typeNames = new Map<string, string>();
for (const session of reviewerSessions) typeNames.set(session.classTypeId, session.title ?? "Class");
export const reviewerClubClassTypes: ClubClassType[] = [...typeNames].map(([id, name]) => ({ id, organisationId: REVIEWER_ORG_ID, name, description: "Synthetic class listing for App Review Demo.", defaultDurationMinutes: 60, defaultCapacity: 6, active: true, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" }));
export const reviewerClubSessions: ClubClassSession[] = reviewerSessions.map(session => ({ ...session, instructorName: "Coach Morgan" }));
export const reviewerClubAttendance = [
  { name: "Alex Morgan", time: "18:02", location: "Carlton", status: "Checked in" },
  { name: "Sam Taylor", time: "18:06", location: "Rotherham", status: "Checked in" },
  { name: "Jamie Parker", time: "18:12", location: "Carlton", status: "Access not recorded · sample" },
];
export const reviewerClubStaff = [
  { name: "Jordan Lee", role: "Gym staff", location: "Carlton", status: "On shift" },
  { name: "Casey Reed", role: "Coach / PT", location: "Rotherham", status: "Class host" },
];
export const reviewerClubCheckData: Record<string, unknown> = {
  cycle: { status: "open" }, total: 5, completed: 3, item_total: 3, item_done: 2, equipment_total: 2, equipment_done: 1, unresolved_issues: 0,
  items: [
    { id: "demo-check-bin", label: "Reception and changing-room bins", section: "Daily routine", required: true, status: "complete", checked_by_name: "Jordan Lee" },
    { id: "demo-check-floor", label: "Hoover training floor", section: "Daily routine", required: true, status: "complete", checked_by_name: "Jordan Lee" },
    { id: "demo-check-touchpoints", label: "Wipe touch points", section: "Daily routine", required: true, status: "pending" },
  ],
  equipment: [
    { id: "demo-equipment-rack", name: "Squat rack 1", category: "Strength equipment", status: "ok", operational_status: "in_service", checked_by_name: "Jordan Lee" },
    { id: "demo-equipment-bike", name: "Bike 1", category: "Cardio equipment", status: "pending", operational_status: "in_service" },
  ], issues: [], templates: [],
};
export const reviewerClubRoster = reviewerClubMembers.map((member, index) => ({
  bookingId: `demo-booking-${index + 1}`, customerId: member.id, memberName: member.displayName,
  status: "confirmed", attendanceState: index === 0 ? "checked_in" : "pending", paymentMethod: index === 0 ? "transformation_credit" : "stripe",
  paymentStatus: "paid", amountMinor: index === 0 ? 0 : 1000, cashStatus: null, cashDue: 0, cancelledAt: null,
}));

export const reviewerClubProducts = reviewerProducts.map(product => ({ ...product, salesChannels: ["pos", "online"] as Array<"pos" | "online"> }));
export const reviewerClubStockBalances = reviewerClubProducts.map((product, index) => ({
  id: `demo-stock-${index}`, organisationId: REVIEWER_ORG_ID, locationId: REVIEWER_CARLTON_LOCATION_ID,
  productId: product.id, onHand: [12, 8, 24][index] ?? 6, reserved: 0, availableToSell: [12, 8, 24][index] ?? 6,
}));
export const reviewerClubProductLocations = [{ id: REVIEWER_LOCATION_ID, name: "Carlton · demo", active: true }];

export function reviewerClubSession(sessionId?: string) {
  return reviewerClubSessions.find(session => session.id === sessionId);
}
