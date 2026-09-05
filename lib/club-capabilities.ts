import type { ClubRole } from "./club";
export const clubCapabilities = ["members.view","members.create","members.link_account","memberships.assign","memberships.end_immediately","payments.take","payments.record_cash","refunds.issue","refunds.approve","cash.reconcile","inventory.adjust","commerce.stock_remove","members.import","staff.permissions_manage","induction.manage_policy","induction.perform","classes.manage","services.manage","supplier.catalogue_manage","supplier.orders_manage","supplier.receive","commerce.pricing_manage","commerce.collections_manage"] as const;
export type ClubCapability = typeof clubCapabilities[number];
const presets: Record<ClubRole, readonly ClubCapability[]> = {
  owner: clubCapabilities,
  gym_admin: ["members.view", "members.create", "members.link_account", "memberships.assign", "memberships.end_immediately", "payments.take", "payments.record_cash", "refunds.issue", "refunds.approve", "cash.reconcile", "inventory.adjust", "commerce.stock_remove", "members.import", "induction.manage_policy", "classes.manage", "services.manage", "supplier.catalogue_manage", "supplier.orders_manage", "supplier.receive", "commerce.pricing_manage", "commerce.collections_manage"],
  gym_staff: ["members.view", "members.create", "members.link_account", "memberships.assign", "payments.take", "payments.record_cash", "induction.perform", "classes.manage", "services.manage", "supplier.receive", "commerce.collections_manage"],
  trainer: ["members.view", "members.create", "memberships.assign", "payments.take", "payments.record_cash", "induction.perform", "classes.manage", "services.manage", "supplier.receive", "commerce.collections_manage"],
  member: [],
  guest: []
};
export function resolveClubCapabilities(role: ClubRole, overrides: Array<{ capability: string; decision: "allow" | "deny" }> = []) {
  const denied = new Set(overrides.filter(item => item.decision === "deny").map(item => item.capability));
  const allowed = new Set(overrides.filter(item => item.decision === "allow").map(item => item.capability));
  return clubCapabilities.filter(capability => {
    if (capability === "staff.permissions_manage" && role === "owner") return true;
    if (capability === "staff.permissions_manage" && role !== "owner") return false;
    return !denied.has(capability) && (allowed.has(capability) || presets[role].includes(capability));
  });
}
export function hasClubCapability(role: ClubRole, capability: ClubCapability, overrides: Array<{ capability: string; decision: "allow" | "deny" }> = []) { return resolveClubCapabilities(role, overrides).includes(capability); }
