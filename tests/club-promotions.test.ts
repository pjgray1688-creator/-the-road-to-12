import assert from "node:assert/strict";
import test from "node:test";
import { allocateBundle, applyPromotion, chooseGoldenTicketCandidate, promotionIsActive } from "@/lib/club-promotions";

test("promotion windows, locations and integer discounts are authoritative", () => {
  const rule = { id:"p", status:"active" as const, startsAt:"2026-09-01T00:00:00Z", endsAt:"2026-10-01T00:00:00Z", locationIds:["r"], effect:"percentage" as const, percentageBasisPoints:1000 };
  assert.equal(promotionIsActive(rule,new Date("2026-09-15"),"r"),true); assert.equal(promotionIsActive(rule,new Date("2026-10-02"),"r"),false); assert.equal(promotionIsActive(rule,new Date("2026-09-15"),"c"),false); assert.equal(applyPromotion(999,rule),99);
});
test("bundle retains actual component lines and supports repeated sets", () => {
  const lines = [{id:"m",productId:"meal",category:"meals",unitPriceMinor:1200,quantity:2},{id:"d",productId:"drink",category:"drinks",unitPriceMinor:300,quantity:2},{id:"b",productId:"bar",category:"bars",unitPriceMinor:250,quantity:2}];
  const result = allocateBundle(lines,[{required:1,categories:["meals"]},{required:1,categories:["drinks"]},{required:1,categories:["bars"]}],1500); assert.equal(result.qualifies,true); assert.equal(result.lines.length,3); assert.equal(result.savingMinor,250);
});
test("Golden Ticket chooses one highest-saving candidate with deterministic ties", () => { const chosen=chooseGoldenTicketCandidate([{id:"transformation",label:"Transformation",eligibleMinor:11000},{id:"supplements",label:"Supplements",eligibleMinor:14000}]); assert.equal(chosen.id,"supplements"); assert.equal(chooseGoldenTicketCandidate([{id:"b",label:"B",eligibleMinor:10},{id:"a",label:"A",eligibleMinor:10}]).id,"a"); });
