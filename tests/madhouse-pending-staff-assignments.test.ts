import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/2027-01-10-madhouse-pending-staff-assignments.sql", "utf8");
const staffPage = readFileSync("app/club/staff/page.tsx", "utf8");
const setupPage = readFileSync("components/club-class-setup.tsx", "utf8");

test("pending operational staff identities are separate from Auth and access grants", () => {
  assert.match(migration, /create table if not exists public\.club_madhouse_staff_assignments/);
  assert.match(migration, /staff_grant_id uuid references public\.club_staff_access_grants/);
  assert.match(migration, /alter table public\.club_staff_rota_shifts alter column staff_user_id drop not null/);
  assert.match(migration, /club_staff_rota_identity_xor_ck/);
  assert.match(migration, /after update of status on public\.club_staff_access_grants/);
  assert.match(migration, /new\.accepted_by/);
  assert.doesNotMatch(migration, /insert into auth\.users/i);
  assert.doesNotMatch(migration, /update public\.club_members set active=true/i);
});

test("pending class and rota generation retain management, identity, location and idempotency guards", () => {
  assert.match(migration, /club_has_active_role\(p_organisation_id,array\['gym_admin','owner'\]\)[\s\S]+club_capability_allowed\(p_organisation_id,auth\.uid\(\),'classes\.manage'\)/);
  assert.match(migration, /club_madhouse_attach_staff_invitation/);
  assert.match(migration, /g\.coach_requested/);
  assert.match(migration, /a\.location_ids <@ g\.location_ids/);
  assert.match(migration, /on conflict\(organisation_id,source_template_key,source_template_date\)/);
  assert.match(migration, /on conflict\(organisation_id,source_template_key,work_date\)/);
  assert.match(migration, /max_transformation_credit_bookings,visibility,status/);
  assert.match(migration, /a\.canonical_name/);
  assert.match(staffPage, /Link invitation/);
  assert.match(setupPage, /Prepared operational staff identities/);
});

test("follow-up migration is after the already deployed Madhouse class chain", () => {
  const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");
  const predecessor = manifest.indexOf("2027-01-09-madhouse-class-payments-and-register.sql");
  const followUp = manifest.indexOf("2027-01-10-madhouse-pending-staff-assignments.sql");
  assert.ok(predecessor >= 0 && followUp > predecessor);
});
