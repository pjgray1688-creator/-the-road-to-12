import type { MemberHubData } from "@/components/member-hub";
import type { ClubClassAvailability, ClubClassBooking, ClubClassSession } from "@/lib/club-operations";
import type { ClubCommerceProduct } from "@/lib/club-commerce";
import type { GlowZoneHourRow } from "@/components/glow-zone-opening-hours";

export const REVIEWER_ORG_ID = "f0000000-0000-4000-8000-000000000012";
export const REVIEWER_LOCATION_ID = "f0000000-0000-4000-8000-000000000013";
export const REVIEWER_ROTHERHAM_LOCATION_ID = "f0000000-0000-4000-8000-000000000016";
export const REVIEWER_CARLTON_LOCATION_ID = "f0000000-0000-4000-8000-000000000017";
export const REVIEWER_CUSTOMER_ID = "f0000000-0000-4000-8000-000000000014";
const now = "2026-10-01T00:00:00.000Z";

export const reviewerSessions: ClubClassSession[] = [
  ["boxing-rotherham", "Boxing", "2026-10-26T18:00:00+00:00", "Luke", "Rotherham"],
  ["women-carlton", "Women Only", "2026-10-27T19:00:00+00:00", "Amie", "Carlton"],
  ["hiit-carlton", "HIIT", "2026-10-28T18:00:00+00:00", "Keenan", "Carlton"],
  ["circuit-rotherham", "Circuit", "2026-10-28T18:00:00+00:00", "Luke", "Rotherham"],
  ["women-rotherham", "Women Only", "2026-10-29T10:00:00+00:00", "Amie", "Rotherham"],
  ["circuit-carlton", "Circuit", "2026-10-30T10:00:00+00:00", "Keenan", "Carlton"],
].map(([suffix, title, startsAt, instructorName, locationName], index) => ({
  id: `f0000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`,
  organisationId: REVIEWER_ORG_ID, locationId: locationName === "Carlton" ? REVIEWER_CARLTON_LOCATION_ID : REVIEWER_ROTHERHAM_LOCATION_ID, classTypeId: `demo-${title.toLowerCase().replaceAll(" ", "-")}`,
  title, startsAt, endsAt: new Date(new Date(startsAt).getTime() + 60 * 60 * 1000).toISOString(), capacity: 6,
  visibility: "public", status: "scheduled", instructorName, createdAt: now, updatedAt: now,
} satisfies ClubClassSession));

export const reviewerAvailability: Record<string, ClubClassAvailability> = Object.fromEntries(reviewerSessions.map((session, index) => [session.id, {
  sessionId: session.id, capacity: 6, confirmedCount: index === 4 ? 2 : 1, spacesRemaining: index === 4 ? 4 : 5, waitlistedCount: 0, isFull: false,
}]));

export const reviewerBookings: ClubClassBooking[] = [{
  id: "f0000000-0000-4000-8000-000000000015", organisationId: REVIEWER_ORG_ID, sessionId: reviewerSessions[4].id,
  customerId: REVIEWER_CUSTOMER_ID, status: "confirmed", bookedAt: "2026-10-20T10:00:00+01:00", attendanceState: "pending", createdAt: now, updatedAt: now,
}];

export const reviewerProducts: ClubCommerceProduct[] = [
  { id: "demo-product-shaker", organisationId: REVIEWER_ORG_ID, name: "Apocalypse Nutrition Shaker", brand: "Apocalypse Nutrition", category: "Accessories", active: true, stockTracked: true, sellPriceMinor: 800, currency: "GBP", media: { url: "/product-images/active-sports/apocalypse-nutrition-screw-caps-shaker.jpg" }, createdAt: now, updatedAt: now },
  { id: "demo-product-whey", organisationId: REVIEWER_ORG_ID, name: "Per4m Isolate Zero", brand: "Per4m Nutrition", category: "Sports Nutrition", active: true, stockTracked: true, sellPriceMinor: 3999, currency: "GBP", media: { url: "/product-images/active-sports/per4m-nutrition-isolate-zero-100-whey-protein-isolate.jpg" }, createdAt: now, updatedAt: now },
  { id: "demo-product-electrolyte", organisationId: REVIEWER_ORG_ID, name: "NOCCO Electrolyte", brand: "NOCCO", category: "Food & Drinks", active: true, stockTracked: true, sellPriceMinor: 250, currency: "GBP", media: { url: "/product-images/active-sports/nocco-electrolyte.jpg" }, createdAt: now, updatedAt: now },
];

export const reviewerStockBalances = reviewerProducts.map(product => ({
  organisationId: REVIEWER_ORG_ID, locationId: REVIEWER_LOCATION_ID, productId: product.id, onHand: 5, reserved: 0, availableToSell: 5,
}));

export const reviewerGlowHours: GlowZoneHourRow[] = [
  [1, "14:00", "20:00", "confirmed"], [2, "14:00", "20:00", "confirmed"], [3, "14:00", "20:00", "confirmed"],
  [4, "09:00", "20:00", "confirmed"], [5, "09:00", "20:00", "confirmed"], [6, "10:00", "13:00", "confirmed"], [7, null, null, "confirmed_closed"],
].map(([weekday, opens_local, closes_local, confirmation_state]) => ({ weekday, opens_local, closes_local, confirmation_state, time_zone: "Europe/London" } as GlowZoneHourRow));

export function reviewerMemberHubData(): MemberHubData[] {
  const organisation = { id: REVIEWER_ORG_ID, name: "Madhouse Gym", slug: "madhouse", active: true };
  const profile: MemberHubData["profile"] = {
    member: { id: "demo-member", organisationId: REVIEWER_ORG_ID, userId: "demo-reviewer", role: "member", active: true },
    identity: { userId: "demo-reviewer", displayName: "Alex Morgan" }, homeLocation: { id: REVIEWER_LOCATION_ID, name: "Carlton", active: true },
    customer: { id: REVIEWER_CUSTOMER_ID, displayName: "Alex Morgan", status: "member" },
    memberships: [{ id: "demo-membership", productId: "demo-gym-membership", productName: "Madhouse Gym Membership", status: "active", startsAt: "2026-01-01T00:00:00.000Z", source: "subscription", holderUserIds: ["demo-reviewer"] }],
    entitlements: [], serviceCredits: [], access: { state: "unavailable", reason: "no_membership" },
  };
  const schedule = [reviewerSessions[0], reviewerSessions[4]].map(session => ({ id: session.id, eventType: "class" as const, title: session.title ?? "Class", startsAt: session.startsAt, endsAt: session.endsAt, status: "scheduled" as const, staffName: session.instructorName, locationName: session.title === "Boxing" ? "Rotherham" : "Rotherham" }));
  return [{ organisation, profile, balance: { id: "demo-balance", organisationId: REVIEWER_ORG_ID, customerId: REVIEWER_CUSTOMER_ID, currency: "GBP", status: "active", balanceMinor: 1250 }, balanceHistory: [], sessions: reviewerSessions, bookings: [{ sessionId: reviewerBookings[0].sessionId, status: "confirmed" }], orders: [], accessPass: undefined, schedule, lifetimeProductIds: [] }];
}
