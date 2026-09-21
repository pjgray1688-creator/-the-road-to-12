import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/2026-09-21-club-staff-admin-grant-boundary.sql", import.meta.url), "utf8");

test("staff access admin grants require owner authority", () => {
  assert.match(migration, /create or replace function public\.club_create_staff_access_grant/i);
  assert.match(migration, /p_role='gym_admin'\s+and not public\.club_has_active_role\(p_organisation_id,array\['owner'\]\)/i);
  assert.match(migration, /Only an owner may grant admin access/i);
  assert.match(migration, /using errcode='42501'/i);
});

test("staff access boundary preserves admin grants for operational roles", () => {
  assert.match(migration, /p_role not in \('gym_staff','gym_admin','trainer'\)/i);
  assert.match(migration, /public\.club_has_active_role\(p_organisation_id,array\['gym_admin','owner'\]\)/i);
  assert.match(migration, /grant execute on function public\.club_create_staff_access_grant\([^;]+to authenticated/i);
});
