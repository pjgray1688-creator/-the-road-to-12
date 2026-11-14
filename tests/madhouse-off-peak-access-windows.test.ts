import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/2026-11-14-madhouse-off-peak-access-windows.sql", "utf8");

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const isoWeekday = new Map([["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 7]]);

function approvedWindowModel(instant: string) {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  const day = isoWeekday.get(parts.weekday ?? "") ?? 0;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return (day >= 1 && day <= 5 && minute >= 600 && minute < 900)
    || (day >= 1 && day <= 5 && minute >= 1320)
    || (day >= 2 && day <= 6 && day - 1 >= 1 && day - 1 <= 5 && minute < 180);
}

test("Off-Peak migration installs the approved weekday windows at the decision audit boundary", () => {
  assert.match(migration, /madhouse\.membership\.off-peak\.v1/);
  assert.match(migration, /Exactly one sellable Madhouse Off-Peak membership rule is required/);
  assert.match(migration, /\(1,'10:00'::time,'15:00'::time\),\(1,'22:00'::time,'03:00'::time\)/);
  assert.match(migration, /\(5,'10:00'::time,'15:00'::time\),\(5,'22:00'::time,'03:00'::time\)/);
  assert.match(migration, /p_at at time zone tz/);
  assert.match(migration, /local_time<w\.closes_at/);
  assert.match(migration, /new\.decision='allow' and not public\.club_membership_access_window_allows/);
  assert.match(migration, /raise exception 'Membership access is outside the permitted window'/);
  assert.match(migration, /on conflict\(organisation_id,product_id,weekday,opens_at\) do update/);
});

test("approved hours include Friday night through Saturday 03:00 and exclude other weekend windows", () => {
  const cases: Array<[string, boolean]> = [
    ["2026-11-16T09:59:00Z", false], // Monday 09:59 GMT
    ["2026-11-16T10:00:00Z", true],
    ["2026-11-16T15:00:00Z", false],
    ["2026-11-16T21:59:00Z", false],
    ["2026-11-16T22:00:00Z", true],
    ["2026-11-17T02:59:00Z", true],
    ["2026-11-17T03:00:00Z", false],
    ["2026-11-20T22:00:00Z", true], // Friday night
    ["2026-11-21T02:59:00Z", true], // Saturday from Friday window
    ["2026-11-21T03:00:00Z", false],
    ["2026-11-21T10:00:00Z", false],
    ["2026-11-22T22:00:00Z", false],
    ["2026-11-23T02:00:00Z", false], // Monday early morning is from Sunday
  ];
  for (const [instant, expected] of cases) assert.equal(approvedWindowModel(instant), expected, instant);
});

test("Europe/London DST changes use wall-clock policy without fixed UTC offsets", () => {
  assert.equal(approvedWindowModel("2026-03-30T09:00:00Z"), true); // 10:00 BST Monday
  assert.equal(approvedWindowModel("2026-10-26T10:00:00Z"), true); // 10:00 GMT Monday
  assert.equal(approvedWindowModel("2026-03-29T01:30:00Z"), false); // Sunday after spring change
  assert.equal(approvedWindowModel("2026-10-25T01:30:00Z"), false); // repeated Sunday hour
});
