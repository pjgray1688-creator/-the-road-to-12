export type SupplierSchedule = {
  timezone: string;
  orderingActive?: boolean;
  cutoffWeekday?: number;
  cutoffLocalTime?: string;
  orderWeekday?: number;
  deliveryStartWeekday?: number;
  deliveryEndWeekday?: number;
};

const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function localParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
  return { weekday, date: new Date(Date.UTC(Number(value("year")), Number(value("month")) - 1, Number(value("day")))), minutes: Number(value("hour")) * 60 + Number(value("minute")) };
}

export function supplierCycleFor(date: Date, schedule: SupplierSchedule) {
  if (!schedule.orderingActive && schedule.orderingActive !== undefined) return { key: null, message: "Available to order — collection timing confirmed after order" };
  if (schedule.cutoffWeekday === undefined || !schedule.cutoffLocalTime || schedule.orderWeekday === undefined) return { key: null, message: "Available to order — collection timing confirmed after order" };
  let local: ReturnType<typeof localParts>;
  try { local = localParts(date, schedule.timezone); } catch { return { key: null, message: "Available to order — collection timing confirmed after order" }; }
  const match = /^(\d{1,2}):(\d{2})/.exec(schedule.cutoffLocalTime);
  if (!match || local.weekday < 0 || Number(match[1]) > 23 || Number(match[2]) > 59) return { key: null, message: "Available to order — collection timing confirmed after order" };
  const cutoffMinutes = Number(match[1]) * 60 + Number(match[2]);
  const afterCutoff = local.weekday > schedule.cutoffWeekday || (local.weekday === schedule.cutoffWeekday && local.minutes >= cutoffMinutes);
  let daysToOrder = (schedule.orderWeekday - local.weekday + 7) % 7;
  if (afterCutoff) daysToOrder += 7;
  const cycleDate = new Date(local.date);
  cycleDate.setUTCDate(cycleDate.getUTCDate() + daysToOrder);
  const expected = schedule.deliveryStartWeekday === undefined ? "collection timing confirmed after order" : `${weekdayNames[schedule.deliveryStartWeekday]}${schedule.deliveryEndWeekday !== undefined && schedule.deliveryEndWeekday !== schedule.deliveryStartWeekday ? `–${weekdayNames[schedule.deliveryEndWeekday]}` : ""} collection`;
  const message = schedule.deliveryStartWeekday === undefined ? "Available to order — collection timing confirmed after order" : `Order by ${weekdayNames[schedule.cutoffWeekday]} ${match[1].padStart(2, "0")}:${match[2]} · expected ${expected}`;
  return { key: `${schedule.timezone}:${cycleDate.toISOString().slice(0, 10)}`, message, afterCutoff };
}

export function replenishmentQuantity(freeStock: number, minimum: number, target: number, inbound = 0) {
  if (freeStock + inbound >= minimum) return 0;
  return Math.max(0, target - freeStock - inbound);
}
