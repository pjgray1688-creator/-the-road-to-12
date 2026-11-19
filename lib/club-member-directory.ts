export type ClubDirectorySortField = "name" | "home" | "plan" | "status" | "ends";
export type ClubDirectoryRow = {
  displayName: string;
  email?: string;
  phone?: string;
  ref: string;
  plan?: string;
  status?: string;
  endsAt?: string;
  homeId?: string;
  homeName?: string;
  userId?: string;
  accessState?: string;
  imported: boolean;
};
export type ClubDirectoryFilters = {
  query: string;
  status: string;
  access: string;
  home: string;
  plan: string;
  arrearsUserIds: ReadonlySet<string>;
};

export function clubMembershipStatusMatches(status: string | undefined, filter: string, userId?: string, arrearsUserIds: ReadonlySet<string> = new Set()) {
  if (filter === "all") return true;
  if (filter === "arrears") return Boolean(userId && arrearsUserIds.has(userId));
  const value = (status ?? "").toLowerCase();
  if (filter === "lapsed") return ["expired", "lapsed"].includes(value);
  if (filter === "former") return ["cancelled", "ended", "former", "inactive"].includes(value);
  if (filter === "pending_review") return ["", "pending", "pending_review", "needs_review", "unmapped"].includes(value);
  if (filter === "inactive") return ["paused", "suspended", "inactive"].includes(value);
  return value === filter;
}

/** Expired source records become Former only after the agreed two-month window. */
export function clubDirectoryMembershipStatus(status: string | undefined, endsAt?: string, now = new Date()): string {
  const value = (status ?? "").toLowerCase();
  if (["cancelled", "ended", "former"].includes(value)) return "former";
  if (!["expired", "lapsed"].includes(value) || !endsAt) return value;
  const expiry = new Date(`${endsAt.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(expiry.getTime())) return "lapsed";
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, now.getUTCDate()));
  return expiry < cutoff ? "former" : "lapsed";
}

export function formatClubMemberDisplayName(value?: string) {
  // Presentation-only cleanup: preserve Unicode spelling and letter case.
  return value?.normalize("NFC").trim().replace(/\s+/g, " ") || "Member";
}

export function matchesClubMemberDirectoryFilters(row: ClubDirectoryRow, filters: ClubDirectoryFilters) {
  const term = filters.query.trim().toLocaleLowerCase("en-GB");
  const searchable = `${row.displayName} ${row.email ?? ""} ${row.phone ?? ""} ${row.ref}`.toLocaleLowerCase("en-GB");
  const accessMatches = filters.access === "all" || (!row.imported && row.accessState === filters.access);
  return (!term || searchable.includes(term))
    && clubMembershipStatusMatches(row.status, filters.status, row.userId, filters.arrearsUserIds)
    && accessMatches
    && (filters.home === "all" || row.homeId === filters.home)
    && (filters.plan === "all" || row.plan === filters.plan);
}

export function compareClubMemberDirectoryRows(a: ClubDirectoryRow, b: ClubDirectoryRow, field: ClubDirectorySortField, direction: "asc" | "desc") {
  const left = field === "name" ? a.displayName : field === "home" ? a.homeName ?? "" : field === "plan" ? a.plan ?? "" : field === "status" ? a.status ?? "" : a.endsAt ?? "";
  const right = field === "name" ? b.displayName : field === "home" ? b.homeName ?? "" : field === "plan" ? b.plan ?? "" : field === "status" ? b.status ?? "" : b.endsAt ?? "";
  return left.localeCompare(right, "en-GB", { sensitivity: "base", numeric: true }) * (direction === "asc" ? 1 : -1);
}

export function clubDirectoryPageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}
