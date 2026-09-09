import test from "node:test";
import assert from "node:assert/strict";
import { GLOW_ZONE_LEGAL_ENTITY, GLOW_ZONE_LOCATION, glowZonePackages } from "../lib/glow-zone";
test("GLOW ZONE launch catalogue is Carlton-scoped and priced canonically",()=>{assert.equal(GLOW_ZONE_LOCATION,"Madhouse Gym Carlton");assert.equal(GLOW_ZONE_LEGAL_ENTITY,"MADHOUSE PRODUCTS AND SERVICES LIMITED");assert.deepEqual(glowZonePackages.filter(x=>x.membersOnly).map(x=>[x.minutes,x.priceMinor]),[[30,1000],[100,3000]]);assert.deepEqual(glowZonePackages.filter(x=>!x.membersOnly).map(x=>[x.minutes,x.priceMinor]),[[30,1800],[60,3000],[100,5000]]);});
