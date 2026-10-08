export type ScheduleEventType = "pt_session" | "class" | "unavailable" | "other_location" | "leave" | "leave_request" | "rota_shift" | "admin_time";
export type ScheduleStatus = "scheduled" | "completed" | "cancelled" | "no_show" | "requested" | "approved" | "declined";
export type ScheduleEvent = {
  id: string; leaveRequestId?: string | null; eventType: ScheduleEventType; staffUserId?: string | null; staffName?: string | null;
  customerId?: string | null; privateClientId?: string | null; memberName?: string | null; locationId?: string | null; locationName?: string | null;
  externalLocation?: string | null; title: string; description?: string | null; capacity?: number | null; notes?: string | null; startsAt: string; endsAt: string; status: ScheduleStatus; workingHoursOverride?: boolean;
};
export type WeeklyWorkingHours = { staffUserId: string; weekday: number; startsAt: string; endsAt: string };
export type MemberScheduleItem = { id: string; eventType: "pt_session" | "class"; title: string; startsAt: string; endsAt: string; status: "scheduled"; staffName?: string | null; locationName?: string | null };
export type MemberScheduleNotification = { id: string; action: "booked" | "updated" | "cancelled"; kind: string; title: string; startsAt?: string; location?: string; createdAt: string; seenAt?: string | null };

export function londonDateKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}
export function londonDateTime(value: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...options }).format(new Date(value));
}
export function londonLocalInput(value: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function localDateTimeToIso(value: string) {
  // datetime-local values are UK wall time. Resolve via the platform timezone-free
  // offset search so DST transitions are interpreted in Europe/London.
  const [day, clock] = value.split("T");
  if (!day || !clock) throw new Error("invalid_date");
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  const target = Date.UTC(year, month - 1, date, hour, minute);
  const candidates = [-60, 0, 60, 120].map(offset => new Date(target + offset * 60_000));
  const match = candidates.find(candidate => {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(candidate);
    const part = (type: string) => parts.find(item => item.type === type)?.value;
    return Number(part("year"))===year && Number(part("month"))===month && Number(part("day"))===date && Number(part("hour"))===hour && Number(part("minute"))===minute;
  });
  if (!match) throw new Error("invalid_local_time");
  return match.toISOString();
}
export function scheduleConflict(events: ScheduleEvent[], staffUserId: string, startsAt: string, endsAt: string, exceptId?: string) {
  const from = Date.parse(startsAt); const to = Date.parse(endsAt);
  return events.find(item => item.id !== exceptId && item.staffUserId === staffUserId && item.status === "scheduled" && Date.parse(item.startsAt) < to && Date.parse(item.endsAt) > from);
}
