/** Membership RPCs can return multiple rows per organisation. The dashboard is
 * organisation-scoped, so render each workspace once. */
export function uniqueMembershipOrganisationRows<T extends { organisation?: unknown }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    if (!row.organisation || typeof row.organisation !== "object") return false;
    const id = (row.organisation as Record<string, unknown>).id;
    if (typeof id !== "string" || !id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
