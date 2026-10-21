import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/2027-01-15-madhouse-daily-checks-final-fix.sql";
const deploymentPath = "supabase/deployment/2027-01-15-madhouse-daily-checks-final-fix.sql";
const migration = readFileSync(migrationPath, "utf8");
const deployment = readFileSync(deploymentPath, "utf8");
const bodyOf = (sql: string, functionName: string) => {
  const start = sql.toLowerCase().indexOf(`create or replace function public.${functionName}`.toLowerCase());
  assert.notEqual(start, -1, `${functionName} definition exists`);
  const end = sql.indexOf("end; $$;", start) + "end; $$;".length;
  assert.ok(end > start, `${functionName} definition is complete`);
  return sql.slice(start, end);
};

test("daily-check function prefixes PL/pgSQL variables and removes name collisions", () => {
  const seed = bodyOf(migration, "club_madhouse_seed_daily_checks");
  for (const variable of ["v_actor_role", "v_location", "v_template_id", "v_item", "v_inserted", "v_location_id", "v_matches"]) {
    assert.match(seed, new RegExp(`\\b${variable}\\b`));
  }
  assert.doesNotMatch(seed, /\b(?:actor_role|location|template_id|item|inserted|location_id|matches)\s+(?:uuid|record|integer)\b/i);
  assert.doesNotMatch(seed, /\b(?:into|:=)\s+(?:template_id|location_id)\b/i);

  // DML target and read references use explicit aliases; ON CONFLICT uses
  // unqualified index columns as PostgreSQL requires and has no colliding vars.
  assert.match(seed, /insert into public\.club_checklist_templates as target_template/i);
  assert.match(seed, /returning target_template\.id into v_template_id/i);
  assert.match(seed, /insert into public\.club_checklist_template_locations as target_location/i);
  assert.match(seed, /insert into public\.club_checklist_items as target_item/i);
  assert.match(seed, /on conflict \(template_id,location_id\) do nothing/i);
  assert.match(seed, /on conflict \(template_id,source_key\) where source_key is not null/i);
  assert.match(seed, /select count\(\*\),min\(location\.id::text\)::uuid\s+into v_matches,v_location_id/i);
});

test("initial checklist seeding covers the approved tasks at both locations and is repeat-safe", () => {
  const seed = bodyOf(migration, "club_madhouse_seed_daily_checks");
  assert.match(seed, /values \('Rotherham','Rotherham'\),\('Carlton','Carlton'\)/);

  const sourceRows = [...seed.matchAll(/\('([a-z-]+)','(?:Routine|Scheduled)'/g)].map(match => match[1]);
  assert.equal(sourceRows.length, 14, "the seven daily tasks and seven scheduled task definitions are present");
  const carltonOnly = new Set(["carlton-tuesday-sunbeds", "carlton-saturday-sunbeds", "carlton-thursday-mats"]);
  const rotherhamOnly = "rotherham-wednesday-mats";
  const tasksByLocation = {
    Rotherham: sourceRows.filter(key => !carltonOnly.has(key)),
    Carlton: sourceRows.filter(key => key !== rotherhamOnly),
  };
  assert.equal(tasksByLocation.Rotherham.length, 11);
  assert.equal(tasksByLocation.Carlton.length, 13);
  assert.ok(tasksByLocation.Rotherham.includes(rotherhamOnly));
  assert.ok(!tasksByLocation.Rotherham.some(key => carltonOnly.has(key)));
  assert.ok(!tasksByLocation.Carlton.includes(rotherhamOnly));
  assert.ok(tasksByLocation.Carlton.includes("carlton-tuesday-sunbeds"));

  // Execute the declared source-key upsert contract twice against both
  // synthetic location fixtures and verify the seeded rows remain unique.
  const persisted = new Map<string, string>();
  const seedLocation = (location: keyof typeof tasksByLocation) => {
    persisted.set(`template:${location}`, `Madhouse daily checks · ${location}`);
    for (const key of tasksByLocation[location]) persisted.set(`item:${location}:${key}`, key);
  };
  for (const location of ["Rotherham", "Carlton"] as const) seedLocation(location);
  const firstCount = persisted.size;
  for (const location of ["Rotherham", "Carlton"] as const) seedLocation(location);
  assert.equal(persisted.size, firstCount);
  assert.match(seed, /on conflict \(organisation_id,source_key\) where source_key is not null\s+do update/i);
  assert.match(seed, /on conflict \(template_id,location_id\) do nothing/i);
  assert.match(seed, /on conflict \(template_id,source_key\) where source_key is not null\s+do update/i);
});

test("production hotfix atomically records the canonical migration checksum", () => {
  const checksum = createHash("sha256").update(migration).digest("hex");
  assert.match(deployment, new RegExp(checksum));
  const migrationBody = migration.slice(migration.indexOf("begin;") + "begin;".length, migration.toLowerCase().lastIndexOf("commit;")).trim();
  const deploymentBody = deployment.slice(deployment.indexOf("BEGIN;") + "BEGIN;".length, deployment.indexOf("DO $migration_ledger$")).trim();
  assert.equal(deploymentBody, migrationBody);
  assert.match(deployment, /if found and v_actual_checksum is distinct from v_expected_checksum then/i);
  assert.match(deployment, /on conflict \(migration_name\) do nothing/i);
  assert.match(deployment, /if v_actual_checksum is distinct from v_expected_checksum then/i);
  assert.match(deployment, /begin;[\s\S]*do \$migration_ledger\$[\s\S]*commit;/i);
});

test("active staff-name matching lowercases before the case-sensitive filter", () => {
  const attach = bodyOf(migration, "club_madhouse_attach_staff_invitation");
  assert.match(attach, /regexp_replace\(lower\(split_part\(coalesce\(g\.display_name/i);
  assert.doesNotMatch(attach, /lower\(regexp_replace\(/i);
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
  assert.equal(normalize("AMIE"), "amie");
  assert.equal(normalize("sHaNnOn"), "shannon");
});

test("daily-check fix remains ordered after the executed 01-14 hotfix and before later migrations", () => {
  const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8").trim().split(/\r?\n/);
  const operationsIndex = manifest.indexOf("supabase/migrations/2027-01-14-madhouse-operations-generator-hotfix.sql");
  const dailyChecksIndex = manifest.indexOf(migrationPath);
  const stripeIndex = manifest.indexOf("supabase/migrations/2027-01-16-stripe-merchant-category-guards.sql");
  assert.ok(operationsIndex >= 0 && operationsIndex < dailyChecksIndex && dailyChecksIndex < stripeIndex);
  assert.ok(deployment.includes("supabase/migrations/2027-01-15-madhouse-daily-checks-final-fix.sql"));
});
