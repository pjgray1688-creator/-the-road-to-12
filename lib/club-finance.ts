export type MoneyDirection = "gym_pays_staff" | "staff_owes_gym" | "settled";
export type ApprovalStatus = "draft" | "pending_approval" | "approved" | "queried" | "rejected" | "settled";
export type Collector = "gym" | "staff" | "other";
export type RuleKind = "fixed" | "percentage" | "per_unit";

export type CommercialRule = { kind: RuleKind; amountMinor?: number; basisPoints?: number; units?: number };
export type CommercialResult = { grossMinor: number; collector: Collector; gymEntitlementMinor?: number; staffEntitlementMinor?: number; direction: MoneyDirection; unresolved?: string };

export function calculateCommercialSettlement(input: { grossMinor: number; collector: Collector; gymRule?: CommercialRule; staffRule?: CommercialRule }): CommercialResult {
  if (!Number.isInteger(input.grossMinor) || input.grossMinor < 0) throw new Error("invalid_gross");
  if (!input.gymRule && !input.staffRule) return { grossMinor: input.grossMinor, collector: input.collector, direction: "settled", unresolved: "commercial agreement required" };
  const apply = (rule?: CommercialRule) => !rule ? 0 : rule.kind === "fixed" ? rule.amountMinor ?? 0 : rule.kind === "percentage" ? Math.round(input.grossMinor * (rule.basisPoints ?? 0) / 10000) : (rule.amountMinor ?? 0) * (rule.units ?? 0);
  const gym = Math.max(0, apply(input.gymRule)); const staff = Math.max(0, apply(input.staffRule));
  return { grossMinor: input.grossMinor, collector: input.collector, gymEntitlementMinor: gym, staffEntitlementMinor: staff, direction: gym > staff ? "staff_owes_gym" : staff > gym ? "gym_pays_staff" : "settled" };
}

export type StaffSettlement = { hoursMinor: number; ptPayableMinor: number; classPayableMinor: number; gymCollectedForStaffMinor: number; staffCollectedForGymMinor: number; adjustmentsMinor: number; direction: MoneyDirection; netMinor: number };
export function summariseStaffSettlement(input: Omit<StaffSettlement, "direction" | "netMinor">): StaffSettlement {
  const netMinor = input.hoursMinor + input.ptPayableMinor + input.classPayableMinor + input.gymCollectedForStaffMinor - input.staffCollectedForGymMinor + input.adjustmentsMinor;
  return { ...input, netMinor, direction: netMinor > 0 ? "gym_pays_staff" : netMinor < 0 ? "staff_owes_gym" : "settled" };
}

export type FinanceRow = { occurredAt: string; reference: string; category: string; grossMinor: number; refundMinor?: number; source: string; membership?: boolean };
export function normaliseFinanceRows(rows: FinanceRow[]) { return rows.map(row => ({ ...row, refundMinor: row.refundMinor ?? 0 })).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.reference.localeCompare(b.reference)); }
export function csvEscape(value: unknown) { const text = String(value ?? ""); return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
export function financeCsv(rows: FinanceRow[]) { const normalised = normaliseFinanceRows(rows); return ["date,reference,category,gross_minor,refund_minor,source", ...normalised.map(row => [row.occurredAt, row.reference, row.category, row.grossMinor, row.refundMinor, row.source].map(csvEscape).join(","))].join("\n"); }

export function monthRange(year: number, month: number, timezone = "Europe/London") { if (!Number.isInteger(year) || month < 1 || month > 12) throw new Error("invalid_period"); const from = new Date(Date.UTC(year, month - 1, 1)); const to = new Date(Date.UTC(year, month, 1)); return { from: from.toISOString(), to: to.toISOString(), timezone }; }
export function calculateShiftMinutes(start: string, finish: string, breakMinutes = 0) { const parse = (value: string) => { const match = /^(\d{2}):(\d{2})$/.exec(value); if (!match) throw new Error("invalid_time"); const minutes = Number(match[1]) * 60 + Number(match[2]); if (minutes > 1439) throw new Error("invalid_time"); return minutes; }; const from = parse(start); const rawFinish = parse(finish); if (rawFinish === from) throw new Error("invalid_shift"); const finishMinutes = rawFinish < from ? rawFinish + 1440 : rawFinish; if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes >= finishMinutes - from) throw new Error("invalid_break"); const worked = finishMinutes - from - breakMinutes; if (worked <= 0) throw new Error("invalid_shift"); return worked; }
