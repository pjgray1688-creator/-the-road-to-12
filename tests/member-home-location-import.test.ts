import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { stageMemberCsv } from "@/lib/club-member-import";

const migration = readFileSync("supabase/migrations/2026-12-22-member-import-home-location.sql", "utf8");
const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");

test("Rotherham and Carlton source home-gym values survive CSV staging", () => {
  const staged = stageMemberCsv("full_name,home_location\nRotherham Member,Rotherham\nCarlton Member,Carlton\n");
  assert.equal(staged.rows[0].normalized.homeLocation, "Rotherham");
  assert.equal(staged.rows[1].normalized.homeLocation, "Carlton");
  assert.equal(staged.rows.every(row => row.blockers.length === 0), true);
});

test("server resolution is deterministic, case-insensitive, active and organisation-scoped", () => {
  assert.match(migration, /new\.raw_values->>\(import_mapping->>'homeLocation'\)/);
  assert.match(migration, /from public\.club_member_import_batches[\s\S]+where id=new\.batch_id and organisation_id=new\.organisation_id/);
  assert.match(migration, /l\.organisation_id=new\.organisation_id and l\.active/);
  assert.match(migration, /lower\(btrim\(l\.name\)\)=lower\(source_name\)/);
  assert.match(migration, /lower\(source_name\) in \('rotherham','carlton'\)/);
  assert.match(migration, /regexp_split_to_array\(lower\(l\.name\)/);
  assert.match(migration, /if match_count=1 then/);
  assert.match(migration, /homeLocationStatus','matched/);
});

test("unknown and ambiguous source locations block import instead of choosing a default", () => {
  assert.match(migration, /homeLocationStatus','unknown/);
  assert.match(migration, /Home location does not match an active location in this organisation/);
  assert.match(migration, /homeLocationStatus','ambiguous/);
  assert.match(migration, /Home location matches more than one active location in this organisation/);
  assert.match(migration, /new\.blockers:=coalesce\(new\.blockers,'\[\]'::jsonb\)/);
});

test("new and reconciled imports update home preferences for linked and unlinked customers", () => {
  assert.match(migration, /club_customers[\s\S]+preferred_location_id uuid/);
  assert.match(migration, /new\.outcome not in \('imported','linked'\)/);
  assert.match(migration, /set preferred_location_id=new\.home_location_id/);
  assert.match(migration, /club_members[\s\S]+preferred_location_id=new\.home_location_id/);
  assert.match(migration, /after update of user_id on public\.club_customers/);
});

test("home location remains a preference and migration follows the current launch sequence", () => {
  assert.match(migration, /never grants or restricts venue access/);
  assert.doesNotMatch(migration, /update public\.club_entitlement_grants|insert into public\.club_entitlement_grants|club_evaluate_member_access/);
  assert.ok(manifest.indexOf("supabase/migrations/2026-12-21-active-sports-commerce-link-performance.sql") < manifest.indexOf("supabase/migrations/2026-12-22-member-import-home-location.sql"));
});
