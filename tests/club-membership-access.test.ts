import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mapOrganisation } from "../lib/supabase-club-repository";

const migration = readFileSync(new URL("../supabase/migrations/2026-09-10-club-membership-access.sql", import.meta.url), "utf8");

test("membership access migration uses one authoritative evaluator and fixed validity windows", () => {
  assert.match(migration, /create or replace function public\.club_evaluate_member_access/i);
  assert.match(migration, /m\.status='active' and m\.starts_at<=p_at and \(m\.ends_at is null or m\.ends_at>p_at\)/i);
  assert.match(migration, /g\.starts_at<=p_at and \(g\.ends_at is null or g\.ends_at>p_at\)/i);
  assert.match(migration, /'reason'.*'membership_not_started'.*'membership_expired'.*'membership_inactive'.*'gym_access_missing'/is);
});

test("membership access migration distinguishes snapshot and future location policies", () => {
  assert.match(migration, /assignment-time snapshots/i);
  assert.match(migration, /scope='future_locations'/i);
  assert.match(migration, /p_location_id=any\(v_ids\)/i);
  assert.match(migration, /location_not_included/i);
});

test("membership access RPCs preserve hardened execution boundaries", () => {
  assert.match(migration, /set search_path=pg_catalog,public/i);
  assert.match(migration, /revoke all on function public\.club_get_member_operational_profile/i);
  assert.match(migration, /grant execute on function public\.club_get_member_operational_profile[^;]+to authenticated/i);
  assert.match(migration, /preferred_location_id, organisation_id\) references public\.club_locations\(id, organisation_id\)/i);
});

test("branding remains constrained while access data is provider-neutral", () => {
  assert.equal(mapOrganisation({ id: "o", name: "Gym", slug: "gym", active: true, branding: { coBranding: "unsafe" } }).branding?.coBranding, "r12");
});
