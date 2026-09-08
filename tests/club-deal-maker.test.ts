import test from "node:test";
import assert from "node:assert/strict";
import { dealMakerOffers, dealSummary } from "../lib/club-deal-maker";
test("Deal Maker exposes plain-language offer templates",()=>{assert.ok(dealMakerOffers.some(x=>x.value==="percentage"));assert.ok(dealMakerOffers.some(x=>x.value==="bundle"));assert.match(dealSummary({name:"Summer",offer:"bundle",quantity:3,value:20,target:"Supplements",repeatable:true}),/3 items for £20.00/);});
