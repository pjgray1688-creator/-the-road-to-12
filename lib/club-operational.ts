import type { EntitlementGrant, EntitlementUsage, Membership, OrganisationMember } from "./club";
import type { ClubBalanceAccount, ClubOrder } from "./club-commerce";
import type { ClubCashDeclaration, ClubServiceCreditAccount, ClubServiceCreditEntry } from "./club-commercial-rules";
import type { ClubClassBooking, ClubClassSession, ClubService } from "./club-operations";

export type ClubMemberSummary = OrganisationMember & {
  displayName: string;
  email?: string;
  membershipName?: string;
  membershipStatus?: Membership["status"];
  membershipEndsAt?: string;
  accessState: "active" | "unavailable" | "needs_attention";
};

export type ClubMemberOperationalProfile = {
  summary: ClubMemberSummary;
  customer?: { id: string; displayName: string; email?: string; phone?: string };
  memberships: Array<Membership & { productName?: string }>;
  grants: EntitlementGrant[];
  usage: EntitlementUsage[];
  balance?: ClubBalanceAccount;
  orders: ClubOrder[];
  cashDeclarations: ClubCashDeclaration[];
  bookings: ClubClassBooking[];
  serviceCredits: Array<ClubServiceCreditAccount & { balanceQuantity: number }>;
  serviceCreditEntries: ClubServiceCreditEntry[];
};

export type ClubMemberOperationalRead = {
  member: { id: string; organisationId: string; userId: string; role: string; active: boolean };
  homeLocation?: { id: string; name: string; active?: boolean };
  customer?: { id: string; displayName: string; email?: string; phone?: string; status?: string };
  memberships: Array<{ id: string; productId: string; productName?: string; status: string; startsAt: string; endsAt?: string; source: string; holderUserIds: string[] }>;
  entitlements: Array<{ id: string; entitlementKey: string; scope: string; locationIds?: string[]; startsAt: string; endsAt?: string; source: string; allowance?: { quantity: number; period: string }; discount?: { percent: number; period?: string; maxUses?: number } }>;
  serviceCredits: Array<{ id: string; creditKey: string; unit: string; status: string; balanceQuantity: number }>;
  access?: { state: "active" | "needs_attention" | "unavailable"; reason?: string; policy?: string; permittedLocationIds?: string[] | null; membershipId?: string; source?: string; validFrom?: string; validUntil?: string };
};
export type ClubMemberSummaryRead = { id: string; organisationId: string; userId: string; role: "member" | "trainer" | "gym_staff" | "gym_admin" | "owner" | "guest"; active: boolean; displayName: string; email?: string; membershipName?: string; membershipStatus?: string; membershipEndsAt?: string; homeLocation?: { id: string; name: string }; accessState: "active" | "needs_attention" | "unavailable" };
export type ClubLocationAccessResult = { allowed: boolean; organisationId: string; locationId: string; membershipId?: string; source?: string; validFrom?: string; validUntil?: string; accessPolicy?: string; reason?: "no_membership" | "membership_inactive" | "membership_not_started" | "membership_expired" | "gym_access_missing" | "location_inactive" | "location_not_included" };
export type ClubLocationHint = { locationId?: string; confidence?: "high" | "medium" | "low" };
export function resolveClubLocation(explicitLocationId: string | undefined, detected: ClubLocationHint | undefined, homeLocationId: string | undefined, permittedLocationIds: string[]) {
  const permitted = new Set(permittedLocationIds);
  if (explicitLocationId && permitted.has(explicitLocationId)) return explicitLocationId;
  if (detected?.locationId && detected.confidence !== "low" && permitted.has(detected.locationId)) return detected.locationId;
  return homeLocationId && permitted.has(homeLocationId) ? homeLocationId : permittedLocationIds.length === 1 ? permittedLocationIds[0] : undefined;
}

export type ClubDashboardSummary = {
  activeMemberCount: number;
  cashAwaitingVerification: number;
  cashDisputes: number;
  upcomingSessions: ClubClassSession[];
  recentOrders: ClubOrder[];
  locations: number;
  products: number;
  services: ClubService[];
};

const labels: Record<string, string> = {
  gym_access: "Gym access", core_training: "R12 Training", enhanced_training: "Enhanced training",
  nutrition: "Nutrition", trainer_managed: "Coach-managed programme",
};
export function entitlementLabel(key: string) { return labels[key] ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()); }

export function entitlementIsActive(grant: EntitlementGrant, now = new Date()) {
  const start = new Date(grant.validity.startsAt).getTime(); const end = grant.validity.endsAt ? new Date(grant.validity.endsAt).getTime() : Infinity;
  return start <= now.getTime() && now.getTime() < end;
}

export function memberAccessState(grants: EntitlementGrant[], memberships: Membership[], now = new Date()): ClubMemberSummary["accessState"] {
  if (grants.some(grant => grant.entitlementKey === "gym_access" && entitlementIsActive(grant, now))) return "active";
  if (memberships.some(membership => membership.status === "active")) return "needs_attention";
  return "unavailable";
}

export function orderStateLabel(status: string) {
  return ({ pending_payment: "Payment needed", awaiting_cash_verification: "Awaiting cash verification", cash_disputed: "Cash needs review", paid: "Paid", fulfilled: "Completed", cancelled: "Cancelled", refunded: "Refunded" } as Record<string, string>)[status] ?? "In progress";
}
