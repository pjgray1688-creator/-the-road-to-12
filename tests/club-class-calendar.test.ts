import assert from "node:assert/strict";
import test from "node:test";
import { classSessionsInLondonWeek, londonClassWeekBounds, upcomingClassSessions } from "@/lib/club-class-calendar";

const session = (id: string, startsAt: string, status = "scheduled") => ({ id, startsAt, status });

test("default class listing is chronological, upcoming only, and limited to six", () => {
  const now = new Date("2026-10-23T12:00:00.000Z");
  const rows = [
    session("past", "2026-10-20T18:00:00.000Z"),
    ...Array.from({ length: 8 }, (_, index) => session(`future-${index}`, `2026-10-${String(24 + index).padStart(2, "0")}T18:00:00.000Z`)),
    session("cancelled", "2026-10-24T19:00:00.000Z", "cancelled"),
  ];
  assert.deepEqual(upcomingClassSessions(rows, now).map(row => row.id), ["future-0", "future-1", "future-2", "future-3", "future-4", "future-5"]);
});

test("week browsing uses Europe/London dates across midnight and keeps historical sessions", () => {
  const rows = [
    session("before-london-midnight", "2026-10-25T00:30:00.000Z"),
    session("after-london-midnight", "2026-10-25T01:30:00.000Z"),
    session("previous-week", "2026-10-18T10:00:00.000Z"),
  ];
  assert.deepEqual(londonClassWeekBounds("2026-10-25"), { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(classSessionsInLondonWeek(rows, "2026-10-25").map(row => row.id), ["before-london-midnight", "after-london-midnight"]);
  assert.deepEqual(classSessionsInLondonWeek(rows, "2026-10-18").map(row => row.id), ["previous-week"]);
});
