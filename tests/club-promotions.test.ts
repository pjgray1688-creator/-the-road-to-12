import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { allocateBundle, allocateBundles, applyPromotion, chooseGoldenTicketCandidate, deriveGoldenTicketCandidates, goldenTicketEligible, promotionIsActive, resolvePromotionStacking } from "@/lib/club-promotions";

test("promotion windows, locations and integer discounts are authoritative", () => {
  const rule = { id:"p", status:"active" as const, startsAt:"2026-09-01T00:00:00Z", endsAt:"2026-10-01T00:00:00Z", locationIds:["r"], effect:"percentage" as const, percentageBasisPoints:1000 };
  assert.equal(promotionIsActive(rule,new Date("2026-09-15"),"r"),true); assert.equal(promotionIsActive(rule,new Date("2026-10-02"),"r"),false); assert.equal(promotionIsActive(rule,new Date("2026-09-15"),"c"),false); assert.equal(applyPromotion(999,rule),99);
});
test("bundle retains actual component lines and supports repeated sets", () => {
  const lines = [{id:"m",productId:"meal",category:"meals",unitPriceMinor:1200,quantity:2},{id:"d",productId:"drink",category:"drinks",unitPriceMinor:300,quantity:2},{id:"b",productId:"bar",category:"bars",unitPriceMinor:250,quantity:2}];
  const result = allocateBundle(lines,[{required:1,categories:["meals"]},{required:1,categories:["drinks"]},{required:1,categories:["bars"]}],1500); assert.equal(result.qualifies,true); assert.equal(result.lines.length,3); assert.equal(result.savingMinor,250);
});
test("Golden Ticket chooses one highest-saving candidate with deterministic ties", () => { const chosen=chooseGoldenTicketCandidate([{id:"transformation",label:"Transformation",eligibleMinor:11000},{id:"supplements",label:"Supplements",eligibleMinor:14000}]); assert.equal(chosen.id,"supplements"); assert.equal(chooseGoldenTicketCandidate([{id:"b",label:"B",eligibleMinor:10},{id:"a",label:"A",eligibleMinor:10}]).id,"a"); });
test("repeatable bundles consume quantities once and produce two complete sets", () => {
  const lines = ["m1","m2"].map((id) => ({ id, productId: id, category: id.startsWith("m") ? "meal" : "drink", unitPriceMinor: 500, quantity: 2 }));
  const result = allocateBundles([...lines, { id: "d", productId: "d", category: "drink", unitPriceMinor: 200, quantity: 2 }, { id: "s", productId: "s", category: "snack", unitPriceMinor: 300, quantity: 2 }], [{ required: 1, categories: ["meal"] }, { required: 1, categories: ["drink"] }, { required: 1, categories: ["snack"] }], 700);
  assert.equal(result.bundleCount, 2); assert.equal(result.savingMinor, 600); assert.equal(result.lines.reduce((n, l) => n + l.quantity, 0), 6);
});
test("Golden Ticket savings derive from candidate basket bases and choose £140 over £110", () => {
  const candidates = deriveGoldenTicketCandidates([
    { id: "transformation", label: "Transformation", lines: [{ id: "t", productId: "t", unitPriceMinor: 55000, quantity: 1 }] },
    { id: "supplements", label: "Supplements", lines: [{ id: "s1", productId: "s1", unitPriceMinor: 35000, quantity: 1 }, { id: "s2", productId: "s2", unitPriceMinor: 35000, quantity: 1 }] },
  ]);
  const chosen = chooseGoldenTicketCandidate(candidates); assert.equal(candidates.find(c => c.id === "transformation")?.eligibleMinor, 11000); assert.equal(candidates.find(c => c.id === "supplements")?.eligibleMinor, 14000); assert.equal(chosen.id, "supplements");
});
test("promotion migration persists evidence and rejects identity-less monthly redemption", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/2026-10-01-club-promotions-engine.sql"), "utf8");
  assert.match(sql, /club_golden_ticket_identity_required/); assert.match(sql, /user_id is not null or customer_id is not null/); assert.match(sql, /club_promotion_applied_orders/); assert.match(sql, /club_create_commerce_order/);
  assert.match(sql, /club_resolve_promotion_bundles/); assert.match(sql, /bundle_instances/); assert.match(sql, /remaining/);
});
test("stacking honours priority, exclusivity and explicit combinability", () => {
  const applied = resolvePromotionStacking([{ id: "low", savingMinor: 1000, priority: 1, consumedLineIds: ["line"] }, { id: "high", savingMinor: 2000, priority: 2, consumedLineIds: ["line"] }]);
  assert.deepEqual(applied.map(p => p.id), ["high"]);
  assert.equal(resolvePromotionStacking([{ id: "pct", savingMinor: 1000, combinable: true, consumedLineIds: ["line"] }, { id: "fixed", savingMinor: 500, combinable: true, consumedLineIds: ["line"] }]).length, 2);
});
test("Golden Ticket requires a qualifying entitlement and unused month", () => { assert.equal(goldenTicketEligible(false, false), false); assert.equal(goldenTicketEligible(true, true), false); assert.equal(goldenTicketEligible(true, false), true); });
