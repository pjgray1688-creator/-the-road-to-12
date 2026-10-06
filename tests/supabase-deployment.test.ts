import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import test from "node:test";

const manifestPath = "supabase/deployment/2026-11-22-madhouse-launch-migrations.txt";
const manifest = readFileSync(manifestPath, "utf8");
const migrations = manifest.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
const runner = readFileSync("scripts/apply-madhouse-schema.sh", "utf8");
const profile = readFileSync("supabase/deployment/2026-11-22-r12-profile-foundation.sql", "utf8");

test("deployment manifest contains existing files in dependency order", () => {
  assert.ok(migrations.length > 70);
  for (const file of migrations) assert.equal(existsSync(file), true, file);
  assert.equal(new Set(migrations).size, migrations.length);
  const position = (name: string) => migrations.indexOf(name);
  assert.ok(position("supabase/migrations/2026-09-22-club-supplier-commerce.sql") < position("supabase/migrations/2026-10-13-club-supplier-catalogue-parent-variants.sql"));
  assert.ok(position("supabase/migrations/2026-10-13-club-supplier-catalogue-parent-variants.sql") < position("supabase/migrations/2026-09-15-shared-shop-supplier-catalogue.sql"));
  assert.ok(position("supabase/migrations/2026-10-13-glow-zone-transactional.sql") < position("supabase/migrations/2026-09-17-glow-age-status-read.sql"));
  assert.ok(position("supabase/migrations/2026-09-03-club-foundation.sql") < position("supabase/migrations/2026-09-03-club-branding.sql"));
  assert.ok(position("supabase/migrations/2026-09-13-club-staff-capabilities-audit.sql") < position("supabase/migrations/2026-09-06-club-staff-access-grants.sql"));
});

test("deployment runner is ledgered, deterministic and stops on unexpected SQL errors", () => {
  assert.match(runner, /ON_ERROR_STOP=1/);
  assert.match(runner, /r12_schema_migrations/);
  assert.match(runner, /manual-baseline/);
  assert.match(runner, /Checksum mismatch/);
  assert.match(runner, /exit 4/);
  assert.doesNotMatch(runner, /supabase db push/);
  assert.doesNotMatch(runner, /auth\.users|create user|insert into public\.club_members/i);
});

test("deployment package explicitly excludes destructive and data-seeding artifacts", () => {
  assert.doesNotMatch(manifest, /club-go-live-reset/);
  assert.doesNotMatch(manifest, /morning-stocktake|rotherham-stocktake|missing-seven/);
  assert.doesNotMatch(manifest, /reviewed-family-images|backfill-active-sports-generated-prices/);
});

test("profile foundation is additive and preserves existing accounts and rows", () => {
  assert.match(profile, /create table if not exists public\.profiles/);
  for (const field of ["email", "display_name", "first_name", "last_name", "timezone", "step_goal", "goals", "training_profile", "generated_programme", "active_programme_id", "updated_at"]) assert.match(profile, new RegExp(`add column if not exists ${field}`));
  assert.match(profile, /on delete cascade/);
  assert.doesNotMatch(profile, /insert into auth\.users/i);
});
