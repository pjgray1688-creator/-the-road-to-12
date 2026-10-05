import type { ClubRole } from "./club";

export const clubCapabilities = [
  "members.view", "members.create", "members.link_account", "memberships.assign",
  "memberships.end_immediately", "payments.take", "payments.record_cash", "refunds.issue",
  "refunds.approve", "cash.reconcile", "inventory.adjust", "commerce.stock_remove",
  "members.import", "staff.permissions_manage", "induction.manage_policy", "induction.perform",
  "classes.manage", "services.manage", "supplier.catalogue_manage", "supplier.orders_manage",
  "supplier.receive", "commerce.pricing_manage", "commerce.collections_manage", "finance.view",
  "finance.manage", "staff.work_submit", "staff.work_review", "finance.export",
] as const;

export type ClubCapability = typeof clubCapabilities[number];
export const fullManagementCapabilities: readonly ClubCapability[] = clubCapabilities;
export const operationalStaffCapabilities = [
  "members.view", "members.create", "members.link_account", "memberships.assign",
  "payments.take", "payments.record_cash", "refunds.issue", "inventory.adjust",
  "commerce.stock_remove", "induction.perform", "classes.manage", "services.manage",
  "supplier.orders_manage", "supplier.receive", "commerce.collections_manage", "staff.work_submit",
] as const satisfies readonly ClubCapability[];

const presets: Record<ClubRole, readonly ClubCapability[]> = {
  owner: fullManagementCapabilities,
  gym_admin: fullManagementCapabilities,
  gym_staff: operationalStaffCapabilities,
  trainer: operationalStaffCapabilities,
  member: [],
  guest: [],
};
const staffRoles: readonly ClubRole[] = ["owner", "gym_admin", "gym_staff", "trainer"];
const managementOnly = new Set<ClubCapability>(["staff.permissions_manage"]);

export function resolveClubCapabilities(role: ClubRole, overrides: Array<{ capability: string; decision: "allow" | "deny" }> = []) {
  if (!staffRoles.includes(role)) return [];
  const denied = new Set(overrides.filter(item => item.decision === "deny").map(item => item.capability));
  const allowed = new Set(overrides.filter(item => item.decision === "allow").map(item => item.capability));
  return clubCapabilities.filter(capability => {
    if (denied.has(capability)) return false;
    if (managementOnly.has(capability) && role !== "owner" && role !== "gym_admin") return false;
    return allowed.has(capability) || presets[role].includes(capability);
  });
}

export function hasClubCapability(role: ClubRole, capability: ClubCapability, overrides: Array<{ capability: string; decision: "allow" | "deny" }> = []) {
  return resolveClubCapabilities(role, overrides).includes(capability);
}
