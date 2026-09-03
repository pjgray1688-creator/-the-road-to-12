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
