export const checklistStatuses = ["complete", "issue", "not_applicable"] as const;
export const equipmentCheckStatuses = ["ok", "issue", "out_of_service", "not_present"] as const;
export const maintenanceStatuses = ["reported", "acknowledged", "in_progress", "awaiting_parts", "resolved", "closed"] as const;

export type ChecklistStatus = typeof checklistStatuses[number];
export type EquipmentCheckStatus = typeof equipmentCheckStatuses[number];
export type MaintenanceStatus = typeof maintenanceStatuses[number];

export function operationalDateAt(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function checkProgress(completed: number, total: number) {
  return { completed, total, percent: total ? Math.round((completed / total) * 100) : 100 };
}

export function maintenanceStatusLabel(status: string) {
  return status.replaceAll("_", " ").replace(/\b\w/g, value => value.toUpperCase());
}
