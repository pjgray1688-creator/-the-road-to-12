import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hotfixPath = "supabase/migrations/2027-01-14-madhouse-operations-generator-hotfix.sql";
const hotfix = readFileSync(hotfixPath, "utf8");
const manifest = readFileSync("supabase/deployment/2026-11-22-madhouse-launch-migrations.txt", "utf8");

const functionBody = (name: string) => {
  const start = hotfix.toLowerCase().indexOf(`create or replace function public.${name}`.toLowerCase());
  assert.notEqual(start, -1, `${name} is included in the forward hotfix`);
  const end = hotfix.indexOf("end; $$;", start) + "end; $$;".length;
  assert.ok(end > start, `${name} has a complete function body`);
  return hotfix.slice(start, end);
};

test("daily-check seeding is unambiguous and repeat-safe", () => {
  const seed = functionBody("club_madhouse_seed_daily_checks");
  assert.match(seed, /v_template_id\s+uuid/i);
  assert.doesNotMatch(seed, /\btemplate_id\s+uuid\b/i);
  assert.match(seed, /returning id into v_template_id/i);
  assert.match(seed, /values\(v_template_id,p_organisation_id,location_id,auth\.uid\(\)\)/i);
  assert.match(seed, /values\(v_template_id,p_organisation_id,item\.section/i);
  assert.doesNotMatch(seed, /values\(template_id,/i);
  assert.match(seed, /on conflict\(organisation_id,source_key\) where source_key is not null do update/i);
  assert.match(seed, /on conflict\(template_id,location_id\) do nothing/i);
  assert.match(seed, /on conflict\(template_id,source_key\) where source_key is not null do update/i);
  assert.equal((seed.match(/insert into public\.club_checklist_items\(/gi) ?? []).length, 1,
    "repeat calls upsert the same stable source-keyed checklist items rather than adding another insert path");
  assert.match(hotfix, /begin;[\s\S]*?commit;/i);
});

test("class and rota staff matching lower names before case-sensitive normalization", () => {
  for (const name of ["club_madhouse_generate_class_sessions", "club_madhouse_generate_rota"]) {
    const body = functionBody(name);
    assert.match(body, /regexp_replace\(lower\(/i);
    assert.doesNotMatch(body, /lower\(regexp_replace\(/i);
  }
  const normalize = (name: string) => name.toLowerCase().replace(/[^a-z]/g, "");
  assert.equal(normalize("LUKE"), "luke");
  assert.equal(normalize("AmIe"), "amie");
  assert.equal(normalize("SHANNON"), "shannon");
});

test("the forward hotfix manifest does not replay earlier Madhouse migrations", () => {
  const lines = manifest.split(/\r?\n/).filter(Boolean);
  assert.equal(lines.at(-1), hotfixPath);
  assert.equal(lines.filter(line => /2027-01-(?:08|10)-/.test(line)).length, 2,
    "prior migrations remain in the manifest for ledger-based skip, and the hotfix is appended separately");
  assert.match(hotfix, /revoke all on function public\.club_madhouse_seed_daily_checks\(uuid\)/i);
  assert.match(hotfix, /grant execute on function public\.club_madhouse_seed_daily_checks\(uuid\) to authenticated/i);
});

test("class setup page uses Club styles and branded management actions", () => {
  const page = readFileSync("app/club/classes/setup/page.tsx", "utf8");
  const component = readFileSync("components/club-class-setup.tsx", "utf8");
  assert.match(page, /module-page club-page club-classes-page/);
  assert.equal((component.match(/className="primary" type="button"/g) ?? []).length, 3);
});
