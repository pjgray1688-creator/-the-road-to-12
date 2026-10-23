export type ClubFinancePreset = "today" | "7d" | "30d" | "custom";

const londonDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
const shiftDate = (key: string, days: number) => {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
};

/** Convert a Europe/London calendar date boundary to UTC, including DST. */
export function londonMidnightUtc(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const represented = Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), Number(value.hour), Number(value.minute), Number(value.second));
    guess += target - represented;
  }
  return new Date(guess);
}

export function resolveClubFinancePeriod(input: { preset?: string; from?: string; to?: string }, now = new Date()) {
  const preset: ClubFinancePreset = input.preset === "today" || input.preset === "7d" || input.preset === "30d" || input.preset === "custom" ? input.preset : "30d";
  const today = londonDate(now);
  let fromKey = today;
  let toKey = today;
  if (preset === "7d" || preset === "30d") fromKey = shiftDate(today, preset === "7d" ? -6 : -29);
  if (preset === "custom") {
    const isDate = (value?: string) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
    fromKey = isDate(input.from) ? input.from! : today;
    toKey = isDate(input.to) ? input.to! : today;
    if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];
  }
  const from = londonMidnightUtc(fromKey);
  const to = new Date(londonMidnightUtc(shiftDate(toKey, 1)).getTime() - 1);
  return { preset, fromKey, toKey, from, to };
}

export function londonDateKey(date: string | Date) {
  return londonDate(typeof date === "string" ? new Date(date) : date);
}
