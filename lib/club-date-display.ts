const dateKey = (value: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  return `${parts.find(part => part.type === "year")!.value}-${parts.find(part => part.type === "month")!.value}-${parts.find(part => part.type === "day")!.value}`;
};

function formatDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium" }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

/** Render date-only values without allowing the browser's local timezone to shift the day. */
export function formatClubDate(value: string | null | undefined) {
  if (!value) return "Date not recorded";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDateKey(value);
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatDateKey(dateKey(date, "Europe/London")) : "Date not recorded";
}

/** Membership ends_at is an exclusive boundary (midnight after the paid-through day). */
export function membershipPaidThroughDate(value: string | null | undefined) {
  if (!value) return "Date not recorded";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatDateKey(value);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date not recorded";
  const key = dateKey(date, "Europe/London");
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const atLocalMidnight = parts.find(part => part.type === "hour")?.value === "00"
    && parts.find(part => part.type === "minute")?.value === "00"
    && parts.find(part => part.type === "second")?.value === "00";
  const [year, month, day] = key.split("-").map(Number);
  const paidThrough = atLocalMidnight ? new Date(Date.UTC(year, month - 1, day - 1, 12)) : new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium" }).format(paidThrough);
}

export function membershipPaidThroughDateInput(value: string | null | undefined) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const key = dateKey(date, "Europe/London");
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const atLocalMidnight = parts.find(part => part.type === "hour")?.value === "00"
    && parts.find(part => part.type === "minute")?.value === "00"
    && parts.find(part => part.type === "second")?.value === "00";
  const [year, month, day] = key.split("-").map(Number);
  return atLocalMidnight ? new Date(Date.UTC(year, month - 1, day - 1, 12)).toISOString().slice(0, 10) : key;
}
