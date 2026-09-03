/** R12 Club foundation. Pure domain contracts keep Club multi-tenant and
 * entitlement-driven without coupling member training to a gym provider. */
export type ClubRole = "member" | "trainer" | "gym_staff" | "gym_admin" | "owner" | "guest";
export type GrantSource = "purchase" | "subscription" | "staff_assignment" | "promotion" | "migration" | "founding";
export type Validity = { startsAt: string; endsAt?: string };
export type OrganisationBranding = { displayName?: string; logoSrc?: string; logoDarkSrc?: string; logoLightSrc?: string; primaryAccent?: string; secondaryAccent?: string; coBranding: "r12" | "co_branded"; backgroundSrc?: string; };
export type Organisation = { id: string; name: string; slug: string; active: boolean; branding?: OrganisationBranding };
export type OrganisationLocation = { id: string; organisationId: string; name: string; active: boolean };
export type OrganisationMember = { id: string; organisationId: string; userId: string; role: ClubRole; active: boolean };
export type ClubProduct = { id: string; organisationId: string; name: string; kind: "membership" | "class" | "pt" | "transformation"; priceMinor: number; currency: string; billing: "one_off" | "recurring" | "manual"; durationDays?: number; sellable: boolean; archivedAt?: string; entitlements?: ProductEntitlement[] };
export type EntitlementDefinition = { key: string; label: string; kind: "boolean" | "scoped_access" | "allowance" | "discount"; defaultScope?: "organisation" | "location" };
export type ProductEntitlement = { productId: string; entitlementKey: string; scope: "organisation" | "locations" | "future_locations"; locationIds?: string[]; allowance?: { quantity: number; period: "week" | "month" | "block" }; discount?: { percent: number; period?: "month"; maxUses?: number } };
export type Membership = { id: string; organisationId: string; productId: string; billingGroupId?: string; status: "active" | "paused" | "expired" | "cancelled"; validity: Validity; source: GrantSource; holderUserIds: string[] };
export type EntitlementGrant = { id: string; userId: string; organisationId: string; membershipId?: string; entitlementKey: string; scope: "organisation" | "locations" | "future_locations"; locationIds?: string[]; validity: Validity; source: GrantSource; allowance?: { quantity: number; period: "week" | "month" | "block" }; discount?: { percent: number; period?: "month"; maxUses?: number } };
export type EntitlementUsage = { id: string; grantId: string; userId: string; periodKey: string; quantity: number; reference?: string; createdAt: string };

const safeColour = (value: string | undefined, fallback: string) => value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
export function resolveOrganisationTheme(organisation: Organisation | undefined) {
  const branding = organisation?.active ? organisation.branding : undefined;
  return { platform: "R12", organisationName: branding?.displayName ?? organisation?.name ?? "R12 Club", coBranding: branding?.coBranding ?? "r12", logoSrc: branding?.logoSrc, primaryAccent: safeColour(branding?.primaryAccent, "#a855f7"), secondaryAccent: safeColour(branding?.secondaryAccent, "#c084fc"), backgroundSrc: branding?.backgroundSrc } as const;
}

const timestamp = (value: string | Date) => new Date(value).getTime();
export function isValidAt(validity: Validity, at: string | Date): boolean { const point = timestamp(at); return point >= timestamp(validity.startsAt) && (validity.endsAt === undefined || point < timestamp(validity.endsAt)); }
export function periodKey(period: "week" | "month" | "block", at: string | Date): string { const date = new Date(at); if (period === "month") return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; if (period === "week") { const anchor = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); const day = anchor.getUTCDay() || 7; anchor.setUTCDate(anchor.getUTCDate() - day + 1); return anchor.toISOString().slice(0, 10); } return "block"; }
export function grantAppliesToLocation(grant: EntitlementGrant, organisationId: string, locationId?: string): boolean { if (grant.organisationId !== organisationId) return false; if (grant.scope === "future_locations") return true; if (grant.scope === "organisation" && !grant.locationIds?.length) return true; return Boolean(locationId && grant.locationIds?.includes(locationId)); }
export function resolveEntitlements(userId: string, grants: EntitlementGrant[], at: string | Date = new Date()): EntitlementGrant[] { return grants.filter(grant => grant.userId === userId && isValidAt(grant.validity, at)); }
export function canAccess(userId: string, key: string, grants: EntitlementGrant[], at: string | Date = new Date()): boolean { return resolveEntitlements(userId, grants, at).some(grant => grant.entitlementKey === key); }
export function canAccessGym(userId: string, organisationId: string, locationId: string, grants: EntitlementGrant[], at: string | Date = new Date()): boolean { return resolveEntitlements(userId, grants, at).some(grant => grant.entitlementKey === "gym_access" && grantAppliesToLocation(grant, organisationId, locationId)); }
export function remainingAllowance(grant: EntitlementGrant, usage: EntitlementUsage[], at: string | Date = new Date()): number | undefined { if (!grant.allowance) return undefined; const used = usage.filter(item => item.grantId === grant.id && item.userId === grant.userId && item.periodKey === periodKey(grant.allowance!.period, at)).reduce((sum, item) => sum + item.quantity, 0); return Math.max(0, grant.allowance.quantity - used); }
export function canConsume(grant: EntitlementGrant, quantity: number, usage: EntitlementUsage[], at: string | Date = new Date()): boolean { const remaining = remainingAllowance(grant, usage, at); return remaining === undefined ? false : quantity > 0 && remaining >= quantity && isValidAt(grant.validity, at); }
export function consumeAllowance(grant: EntitlementGrant, quantity: number, usage: EntitlementUsage[], reference?: string, at: string | Date = new Date()): EntitlementUsage { if (!canConsume(grant, quantity, usage, at)) throw new Error("allowance_unavailable"); return { id: `${grant.id}:${periodKey(grant.allowance!.period, at)}:${usage.length + 1}`, grantId: grant.id, userId: grant.userId, periodKey: periodKey(grant.allowance!.period, at), quantity, reference, createdAt: new Date(at).toISOString() }; }

/** Safe acceptance fixtures for deterministic tests/manual review; not production seed data. */
export const clubAcceptanceFixtures = {
  dayPass: { kind: "membership", billing: "one_off", durationDays: 1, priceMinor: 500 },
  monthlyClasses: { kind: "membership", billing: "recurring", priceMinor: 2700, classCredits: 4, period: "month" },
  yearlyClasses: { kind: "membership", billing: "recurring", priceMinor: 25000, classCredits: 1, period: "week" },
  bronze: { kind: "transformation", billing: "one_off", durationDays: 70, ptPerWeek: 1 },
  silver: { kind: "transformation", billing: "one_off", durationDays: 70, ptPerWeek: 2 },
  gold: { kind: "transformation", billing: "one_off", durationDays: 70, ptPerWeek: 3 },
  ptBlock: { kind: "pt", billing: "one_off", credits: 10 },
  goldenTicket: { kind: "membership", billing: "one_off", lifetime: true, futureLocations: true, monthlyDiscountPercent: 20, monthlyDiscountUses: 1 },
} as const;
