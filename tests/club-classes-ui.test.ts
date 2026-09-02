import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { presentClassAvailability } from "../lib/class-availability";

const availability = (spacesRemaining: number, waitlistedCount = 0) => ({ sessionId: "session", capacity: 20, confirmedCount: 20 - spacesRemaining, spacesRemaining, waitlistedCount, isFull: spacesRemaining === 0 });
const page = readFileSync(new URL("../app/club/classes/page.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("../app/club/classes/actions.ts", import.meta.url), "utf8");
const components = readFileSync(new URL("../components/club-classes.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/2026-09-07-club-classes-bookings-services.sql", import.meta.url), "utf8");

test("class availability wording uses factual reusable thresholds", () => {
  assert.deepEqual(presentClassAvailability(availability(10)), { summary: "20 spaces · 10 booked", status: "10 spaces available", tone: "neutral", fillPercent: 50 });
  assert.equal(presentClassAvailability(availability(9)).status, "Filling up");
  assert.equal(presentClassAvailability(availability(5)).status, "Filling up");
  assert.equal(presentClassAvailability(availability(4)).status, "Only 4 spaces left");
  assert.equal(presentClassAvailability(availability(2)).status, "Only 2 spaces left");
  assert.equal(presentClassAvailability(availability(1)).status, "Last space");
  assert.equal(presentClassAvailability(availability(0)).status, "Full");
  assert.equal(presentClassAvailability(availability(0, 3)).status, "Full · 3 waiting");
});

test("unlimited capacity has no fabricated remaining-space value", () => {
  assert.deepEqual(presentClassAvailability({ sessionId: "unlimited", confirmedCount: 30, waitlistedCount: 0, isFull: false }), { summary: "No fixed capacity", status: "No fixed capacity", tone: "unlimited" });
  assert.match(components, /No fixed capacity/);
});

test("timetable loads privacy-safe availability RPC data instead of aggregating booking rows", () => {
  assert.match(page, /repository\.getClassAvailability\(session\.id\)/);
  assert.match(page, /Promise\.allSettled/);
  assert.doesNotMatch(page + components, /listClassBookings|club_class_bookings|\.from\(/);
  assert.match(components, /Availability is temporarily unavailable\./);
});

test("class type and session editors map through repository-backed server actions", () => {
  assert.match(actions, /context\.repository\.saveClassType\(/);
  assert.match(actions, /context\.repository\.saveClassSession\(/);
  assert.doesNotMatch(actions + components, /\.from\(|\.insert\(|\.update\(|\.upsert\(/);
  for (const field of ["defaultDurationMinutes", "defaultCapacity", "active"]) assert.match(actions, new RegExp(field));
  for (const field of ["locationId", "classTypeId", "hostUserId", "startsAt", "endsAt", "capacity", "bookingOpensAt", "bookingClosesAt", "cancellationClosesAt", "visibility", "status"]) assert.match(actions, new RegExp(field));
});

test("management controls are role-aware and trainer edits remain host-scoped", () => {
  assert.match(components, /const canAdmin = \["gym_admin", "owner"\]\.includes\(role\)/);
  assert.match(components, /role === "trainer" && session\.hostUserId === currentUserId/);
  assert.match(actions, /context\.role !== "trainer" \|\| !input\.id/);
  assert.match(actions, /existing\.hostUserId !== context\.userId \|\| input\.hostUserId !== context\.userId/);
  assert.doesNotMatch(actions, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("classes route has intentional empty, loading and safe error states", () => {
  const loading = readFileSync(new URL("../app/club/classes/loading.tsx", import.meta.url), "utf8"); const error = readFileSync(new URL("../app/club/classes/error.tsx", import.meta.url), "utf8");
  assert.match(components, /No classes scheduled yet/); assert.match(components, />Create class</);
  assert.match(loading, /Loading classes…/);
  assert.match(page + error, /Classes couldn’t be loaded\./);
  assert.doesNotMatch(page + error + components, /Postgres|permission denied|42501/);
});

test("booking privacy and future community boundary remain unchanged", () => {
  assert.match(migration, /club_class_bookings_self_select[\s\S]+customer\.user_id = auth\.uid\(\)/i);
  assert.doesNotMatch(migration, /club_class_bookings_(?:member|customer)_select[\s\S]+using \(true\)/i);
  assert.doesNotMatch(components, /Who(?:'|’)s going|attendee|leaderboard|chat/i);
});
