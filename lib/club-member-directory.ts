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
  if (filter === "inactive") return ["paused", "suspended", "inactive"].includes(value);
  return value === filter;
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
