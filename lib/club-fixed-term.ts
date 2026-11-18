import type { FixedTermUnit } from "./club";

export function validFixedTerm(value: number, unit: FixedTermUnit): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 1200 && ["day", "week", "month"].includes(unit);
}

export function fixedTermLabel(value: number, unit: FixedTermUnit): string {
  const label = unit === "day" ? "day" : unit === "week" ? "week" : "month";
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}

/** Date-only preview matching PostgreSQL calendar arithmetic; the server remains authoritative. */
export function fixedTermEndDate(startDate: string, value: number, unit: FixedTermUnit): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !validFixedTerm(value, unit)) throw new Error("invalid_fixed_term");
  const [year, month, day] = startDate.split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1, day));
  if (base.toISOString().slice(0, 10) !== startDate) throw new Error("invalid_start_date");
  if (unit === "day") base.setUTCDate(base.getUTCDate() + value);
  else if (unit === "week") base.setUTCDate(base.getUTCDate() + value * 7);
  else {
    const targetMonth = base.getUTCMonth() + value;
    const targetYear = base.getUTCFullYear() + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
    base.setUTCFullYear(targetYear, normalizedMonth, Math.min(day, lastDay));
  }
  return base.toISOString().slice(0, 10);
}

/** An imported end date is inclusive; return the exclusive Europe/London boundary date. */
export function importedExpiryBoundaryDate(inclusiveExpiryDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inclusiveExpiryDate)) throw new Error("invalid_expiry_date");
  const date = new Date(`${inclusiveExpiryDate}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== inclusiveExpiryDate) throw new Error("invalid_expiry_date");
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
