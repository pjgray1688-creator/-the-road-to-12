type DatedSession = { startsAt: string; status: string };

const londonDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function upcomingClassSessions<T extends DatedSession>(sessions: readonly T[], now = new Date()): T[] {
  return sessions
    .filter(session => session.status === "scheduled" && Date.parse(session.startsAt) >= now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, 6);
}

export function londonClassWeekBounds(date: string): { start: string; end: string } {
  const day = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(day.getTime())) return { start: date, end: date };
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() - weekday + 1);
  const start = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 6);
  return { start, end: day.toISOString().slice(0, 10) };
}

export function classSessionsInLondonWeek<T extends DatedSession>(sessions: readonly T[], date: string): T[] {
  const { start, end } = londonClassWeekBounds(date);
  return sessions
    .filter(session => {
      const sessionDate = londonDay.format(new Date(session.startsAt));
      return sessionDate >= start && sessionDate <= end;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
