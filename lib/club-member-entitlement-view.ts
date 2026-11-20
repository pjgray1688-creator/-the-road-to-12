export type MemberEntitlement = {
  id: string;
  entitlementKey: string;
  scope: string;
  locationIds?: string[];
  allowance?: { quantity: number; period: string };
  discount?: { percent: number; period?: string; maxUses?: number };
};

/** Collapse repeated presentation of the same benefit while leaving source grant rows untouched. */
export function uniqueMemberEntitlements(values: MemberEntitlement[]): MemberEntitlement[] {
  const seen = new Set<string>();
  return values.filter(value => {
    // The current access state already represents gym_access; historical gym grants
    // should not create a stack of identical access labels on the profile.
    if (value.entitlementKey === "gym_access") return false;
    const key = JSON.stringify([
      value.entitlementKey,
      value.scope,
      [...(value.locationIds ?? [])].sort(),
      value.allowance ?? null,
      value.discount ?? null,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
