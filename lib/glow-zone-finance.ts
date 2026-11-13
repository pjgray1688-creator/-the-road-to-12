export type GlowZoneSaleRecord = {
  amount_minor: number;
  location_id: string;
  status: string;
  created_at: string;
  id?: string;
  tender_type?: string;
  minutes?: number;
};

export type GlowZoneFinanceReport = {
  records: GlowZoneSaleRecord[];
  total_minor: number;
  completed_count: number;
  minutes_sold: number;
};

export type ClubFinanceMemberCounts = {
  activeMembers: number;
  unassignedMembers: number;
  conflictingHomeLocations: number;
  locations: Array<{ id: string; name: string; activeMembers: number }>;
  asOf: string;
};

export function parseClubFinanceMemberCounts(value: unknown): ClubFinanceMemberCounts | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (!Number.isSafeInteger(raw.active_members) || Number(raw.active_members) < 0
    || !Number.isSafeInteger(raw.unassigned_members) || Number(raw.unassigned_members) < 0
    || !Number.isSafeInteger(raw.conflicting_home_locations) || Number(raw.conflicting_home_locations) < 0
    || typeof raw.as_of !== "string" || !Number.isFinite(Date.parse(raw.as_of)) || !Array.isArray(raw.locations)) return undefined;
  const locations = raw.locations.map((entry) => {
    if (!entry || typeof entry !== "object") return undefined;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.name !== "string"
      || !Number.isSafeInteger(item.active_members) || Number(item.active_members) < 0) return undefined;
    return { id: item.id, name: item.name, activeMembers: Number(item.active_members) };
  });
  if (locations.some((item) => item === undefined)) return undefined;
  const typedLocations = locations as Array<{ id: string; name: string; activeMembers: number }>;
  if (new Set(typedLocations.map((item) => item.id)).size !== typedLocations.length
    || typedLocations.reduce((sum, item) => sum + item.activeMembers, 0)
      + Number(raw.unassigned_members) + Number(raw.conflicting_home_locations) !== Number(raw.active_members)) return undefined;
  return {
    activeMembers: Number(raw.active_members),
    unassignedMembers: Number(raw.unassigned_members),
    conflictingHomeLocations: Number(raw.conflicting_home_locations),
    locations: typedLocations,
    asOf: raw.as_of,
  };
}

export function comparePeriodValues(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return undefined;
  const difference = current - previous;
  return {
    difference,
    percentage: previous === 0 ? undefined : difference / Math.abs(previous) * 100,
    direction: difference > 0 ? "up" as const : difference < 0 ? "down" as const : "flat" as const,
  };
}

/** Reject incomplete or contradictory RPC payloads instead of turning them into £0 totals. */
export function parseGlowZoneFinanceReport(value: unknown): GlowZoneFinanceReport | undefined {
  if (!value || typeof value !== "object") return undefined;
  const report = value as Record<string, unknown>;
  if (!Array.isArray(report.records)
    || !Number.isSafeInteger(report.total_minor) || Number(report.total_minor) < 0
    || !Number.isSafeInteger(report.completed_count) || Number(report.completed_count) < 0
    || !Number.isSafeInteger(report.minutes_sold) || Number(report.minutes_sold) < 0) return undefined;
  const records = report.records as unknown[];
  if (!records.every((item) => {
    if (!item || typeof item !== "object") return false;
    const record = item as Record<string, unknown>;
    return record.status === "completed"
      && typeof record.location_id === "string"
      && typeof record.created_at === "string" && Number.isFinite(Date.parse(record.created_at))
      && Number.isSafeInteger(record.amount_minor) && Number(record.amount_minor) >= 0
      && Number.isSafeInteger(record.minutes) && Number(record.minutes) >= 0;
  })) return undefined;
  const typed = records as GlowZoneSaleRecord[];
  const total = typed.reduce((sum, record) => sum + Number(record.amount_minor), 0);
  const minutes = typed.reduce((sum, record) => sum + Number(record.minutes), 0);
  if (total !== report.total_minor || typed.length !== report.completed_count || minutes !== report.minutes_sold) return undefined;
  return { records: typed, total_minor: Number(report.total_minor), completed_count: Number(report.completed_count), minutes_sold: Number(report.minutes_sold) };
}

export function summarizeCompletedGlowSales(
  records: readonly GlowZoneSaleRecord[],
  range: { from: string; to: string; locationId?: string },
) {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  const completed = records.filter((record) => {
    const createdAt = Date.parse(record.created_at);
    const amount = Number(record.amount_minor);
    return record.status === "completed"
      && Number.isSafeInteger(amount)
      && amount >= 0
      && Number.isFinite(createdAt)
      && createdAt >= from
      && createdAt <= to
      && (!range.locationId || record.location_id === range.locationId);
  });
  return {
    amountMinor: completed.reduce((sum, record) => sum + Number(record.amount_minor), 0),
    count: completed.length,
    records: completed,
  };
}
