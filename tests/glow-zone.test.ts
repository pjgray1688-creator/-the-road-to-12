import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GLOW_ZONE_LEGAL_ENTITY, GLOW_ZONE_LOCATION, glowZonePackages } from "../lib/glow-zone";
test("GLOW ZONE launch catalogue is Carlton-scoped and priced canonically",()=>{assert.equal(GLOW_ZONE_LOCATION,"Madhouse Gym Carlton");assert.equal(GLOW_ZONE_LEGAL_ENTITY,"MADHOUSE PRODUCTS AND SERVICES LIMITED");assert.deepEqual(glowZonePackages.filter(x=>x.membersOnly).map(x=>[x.minutes,x.priceMinor]),[[30,1000],[60,1800],[100,3000]]);assert.deepEqual(glowZonePackages.filter(x=>!x.membersOnly).map(x=>[x.minutes,x.priceMinor]),[[30,1500],[60,2500],[100,4000]]);});

test("reception fulfilment uses the same canonical Glow Zone pricing and member age reads remain self-scoped", () => {
  const migration = readFileSync("supabase/migrations/2027-01-20-glow-zone-pricing-and-account-read.sql", "utf8");
  for (const value of ["'member-30' then 1000", "'member-60' then 1800", "'standard-30' then 1500", "'standard-60' then 2500", "else 4000"]) assert.match(migration, new RegExp(value));
  assert.match(migration, /grant select on table public\.club_glow_age_verifications to authenticated/);
  assert.match(readFileSync("supabase/migrations/2026-10-13-glow-zone-transactional.sql", "utf8"), /user_id=auth\.uid\(\)/);
});
