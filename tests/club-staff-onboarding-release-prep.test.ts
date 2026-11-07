import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/club/staff/page.tsx", "utf8");
const form = readFileSync("components/club-staff-access-form.tsx", "utf8");
const styles = readFileSync("components/club-staff-management.module.css", "utf8");
const migrationPath = "supabase/migrations/2026-11-07-staff-invitation-onboarding-and-gym-access.sql";
const migration = readFileSync(migrationPath, "utf8");

test("Staff page removes the eyebrow and hides active prepared identities and Shannon", () => {
  assert.match(page, /<PageHeader title="Staff"/);
  assert.doesNotMatch(page, /eyebrow="R12 CLUB · PEOPLE"/);
  assert.match(page, /normalizedStaffName\(person\.display_name\) === preparedName/);
  assert.match(page, /preparedName !== "shannon"/);
  assert.match(page, /normalized === "amie" \? "aimee"/);
});

test("Add staff action is always visible, purple and keyboard focusable", () => {
  assert.match(form, /styles\.addTrigger/);
  assert.match(form, /aria-hidden="true">\+</);
  assert.match(styles, /background: #812de0 !important/);
  assert.match(styles, /color: #fff !important/);
  assert.match(styles, /\.addTrigger:focus-visible/);
});

test("Prepared identity rows use a compact responsive layout with role and work location", () => {
  assert.match(page, /roleLabel\(String\(linkedRole\)\)/);
  assert.match(page, /Normal work location/);
  assert.match(page, /preparedRow/);
  assert.match(styles, /grid-template-columns: minmax\(150px, 1fr\)/);
  assert.match(styles, /@media \(max-width: 420px\)/);
});

test("November migration reconciles work locations and removes Shannon only from current/future operations", () => {
  assert.equal(existsSync("supabase/migrations/2027-01-29-staff-invitation-onboarding-and-gym-access.sql"), false);
  assert.match(migration, /normalized_name in \('luke','keenan'\)/);
  assert.match(migration, /normalized_name in \('steve','cody'\)/);
  assert.match(migration, /normalized_name='aimee'/);
  assert.match(migration, /normalized_name='shannon'.*?active=false/s);
  assert.match(migration, /staff_name.*?active=false/s);
  assert.match(migration, /r\.status='scheduled'/);
  assert.match(migration, /r\.work_date >= \(now\(\) at time zone 'Europe\/London'\)::date/);
  assert.match(migration, /status='cancelled',updated_at=now\(\)/);
  assert.doesNotMatch(migration, /delete from public\.(club_staff_rota_shifts|club_class_sessions)/i);
});
