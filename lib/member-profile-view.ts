export type MemberProfileMembership = Record<string, unknown> & { status?: unknown; starts_at?: unknown };

export function splitMemberProfileMemberships(values: unknown): { current: MemberProfileMembership[]; past: MemberProfileMembership[] } {
  const memberships = Array.isArray(values)
    ? values.filter((value): value is MemberProfileMembership => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    : [];
  const current = memberships
    .filter(membership => membership.status === "active" || membership.status === "paused")
    .sort((a, b) => String(b.starts_at ?? "").localeCompare(String(a.starts_at ?? "")));
  const past = memberships
    .filter(membership => membership.status !== "active" && membership.status !== "paused")
    .sort((a, b) => String(b.starts_at ?? "").localeCompare(String(a.starts_at ?? "")));
  return { current, past };
}
