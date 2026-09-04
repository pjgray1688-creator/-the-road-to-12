import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/2026-09-19-club-member-account-identity.sql", import.meta.url), "utf8");

test("Club account identity migration is staff-scoped and profile-backed", () => {
  assert.match(migration, /club_resolve_member_identity/);
  assert.match(migration, /club_list_member_identities/);
  assert.match(migration, /public\.profiles/);
  assert.match(migration, /club_has_active_role\(p_organisation_id,array\['gym_staff','gym_admin','owner'\]\)/);
  assert.match(migration, /revoke all on function public\.club_resolve_member_identity/i);
  assert.match(migration, /grant execute on function public\.club_resolve_member_identity[^;]+to authenticated/i);
  assert.doesNotMatch(migration, /auth\.users/);
});
