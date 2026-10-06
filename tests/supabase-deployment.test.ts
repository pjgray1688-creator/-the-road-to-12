import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import test from "node:test";

const manifestPath = "supabase/deployment/2026-11-22-madhouse-launch-migrations.txt";
const manifest = readFileSync(manifestPath, "utf8");
const migrations = manifest.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));
const runner = readFileSync("scripts/apply-madhouse-schema.sh", "utf8");
const profile = readFileSync("supabase/deployment/2026-11-22-r12-profile-foundation.sql", "utf8");
const manualBundlePath = "supabase/deployment/2026-11-22-madhouse-manual-reconciliation.sql";
const manualBundle = readFileSync(manualBundlePath, "utf8");

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

test("manual reconciliation bundle is a single-paste schema contract", () => {
  assert.ok(existsSync(manualBundlePath));
  assert.match(manualBundle, /R12 MADHOUSE MANUAL SCHEMA RECONCILIATION/);
  assert.match(manualBundle, /2026-11-22-r12-profile-foundation\.sql/);
  assert.match(manualBundle, /2026-11-22-r12-deployment-ledger\.sql/);
  for (const required of [
    "2026-11-16-club-staff-permission-model.sql",
    "2026-11-17-club-staff-account-onboarding.sql",
    "2026-11-18-member-acquisition-onboarding.sql",
    "2026-11-19-madhouse-billing-and-tutorials.sql",
    "2026-11-20-club-venue-checks-maintenance.sql",
    "2026-11-21-notification-engine.sql",
    "2026-10-13-club-supplier-catalogue-parent-variants.sql",
  ]) assert.match(manualBundle, new RegExp(required.replaceAll(".", "\\.")));
  for (const baseline of [
    "2026-09-03-club-foundation.sql",
    "2026-09-06-club-staff-access-grants.sql",
    "2026-09-26-coach-safe-workflow.sql",
    "2026-10-05-coach-organisation-boundary.sql",
    "2026-10-05-coach-staff-access-management.sql",
  ]) assert.doesNotMatch(manualBundle, new RegExp(`APPLY supabase/migrations/${baseline}`));
  for (const excluded of [
    "club-go-live-reset.sql",
    "morning-stocktake.sql",
    "rotherham-stocktake.sql",
    "reviewed-family-images.sql",
    "backfill-active-sports-generated-prices.sql",
  ]) assert.doesNotMatch(manualBundle, new RegExp(excluded));
  assert.match(manualBundle, /create table if not exists public\.profiles/);
  assert.match(manualBundle, /READ-ONLY READINESS DIAGNOSTICS/);
  assert.match(manualBundle, /SCHEMA READY — RUN MADHOUSE BOOTSTRAP NEXT/);
  assert.doesNotMatch(manualBundle, /insert into auth\.users/i);
  assert.doesNotMatch(manualBundle, /insert into public\.club_organisations\s*\([^)]*\)\s*values/i);
  assert.match(manualBundle, /r12_schema_migrations/);
});

test("manual bundle contains the missing foundations before dependent historical patches", () => {
  const position = (value: string) => manualBundle.indexOf(value);
  assert.ok(position("-- === R12 WHOOP FOUNDATION ===") > 0);
  assert.ok(position("create table if not exists public.whoop_connections") < position("-- === APPLY supabase/migrations/2026-08-30-whoop-persistence.sql ==="));
  assert.ok(position("create table if not exists public.whoop_records") < position("-- === APPLY supabase/migrations/2026-08-30-whoop-persistence.sql ==="));
  for (const field of ["access_token_encrypted", "refresh_token_encrypted", "expires_at", "scopes", "connected_at", "last_sync_at"]) assert.match(manualBundle, new RegExp(`whoop_connections[\\s\\S]{0,1800}${field}`));
  for (const field of ["provider_id", "record_type", "provider_timestamp", "payload", "synced_at"]) assert.match(manualBundle, new RegExp(`whoop_records[\\s\\S]{0,1800}${field}`));
  assert.ok(position("-- === APPLY supabase/migrations/2026-08-31-workout-persistence.sql ===") < position("-- === APPLY supabase/migrations/2026-09-01-training-programmes.sql ==="));
  assert.ok(migrations.indexOf("supabase/migrations/2026-08-31-workout-persistence.sql") < migrations.indexOf("supabase/migrations/2026-09-26-coach-safe-workflow.sql"));
  assert.ok(position("-- === APPLY supabase/migrations/2026-10-13-club-supplier-catalogue-parent-variants.sql ===") < position("-- === APPLY supabase/migrations/2026-09-15-shared-shop-supplier-catalogue.sql ==="));
  assert.ok(position("-- === APPLY supabase/migrations/2026-10-13-glow-zone-transactional.sql ===") < position("-- === APPLY supabase/migrations/2026-09-17-glow-age-status-read.sql ==="));
  assert.ok(position("-- === APPLY supabase/migrations/2026-11-20-club-venue-checks-maintenance.sql ===") < position("-- === APPLY supabase/migrations/2026-11-21-notification-engine.sql ==="));
  assert.match(manualBundle, /create table if not exists public\.club_member_notification_intents/);
  assert.match(manualBundle, /create table if not exists public\.club_checklist_templates/);
});
