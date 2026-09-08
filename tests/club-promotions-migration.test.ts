import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyPromotionRules, gsnPotOGoldPromotion, mapPromotionRecord } from "../lib/club-promotions";

test("pre-migration schema cannot provide authoritative bundle order pricing", () => {
  const prior = readFileSync("supabase/migrations/2026-09-09-club-cash-credits-promotions.sql", "utf8");
  assert.doesNotMatch(prior, /club_evaluate_commerce_promotions/);
  const migration = readFileSync("supabase/migrations/2026-10-01-club-promotions-engine.sql", "utf8");
  assert.match(migration, /club_evaluate_commerce_promotions/);
  assert.match(migration, /club_create_commerce_order/);
  assert.match(migration, /club_resolve_promotion_bundles/);
  assert.match(migration, /club_promotion_applied_orders/);
  assert.match(migration, /repeatable/);
  for (const policy of migration.matchAll(/create policy\s+(\w+)\s+on\s+([^\s;]+)/gi)) {
    assert.match(migration.slice(0, policy.index), new RegExp(`drop policy if exists ${policy[1]} on ${policy[2]}`, "i"));
  }
});

test("configured global GSN promotion maps to the real basket evaluator contract", () => {
  const ids = Array.from({ length: 38 }, (_, index) => `gsn-${index}`);
  const rule = mapPromotionRecord({ id: "gsn", status: "active", starts_at: null, ends_at: null, location_ids: [], eligibility: { bundle_groups: [{ required_quantity: 10, product_ids: ids }], bundle_price_minor: 3200, repeatable: true } });
  const result = applyPromotionRules([{ id: "line", productId: ids[0], unitPriceMinor: 400, quantity: 10 }], [rule], "carlton");
  assert.equal(result.totalMinor, 3200);
  assert.equal(rule.bundleGroups?.[0]?.productIds?.length, 38);
  assert.equal(rule.repeatable, true);
  assert.equal(gsnPotOGoldPromotion(ids).combinable, false);
});
