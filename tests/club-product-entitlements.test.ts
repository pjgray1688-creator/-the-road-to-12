import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ProductEntitlement } from "../lib/club";
import { MemoryClubRepository, madhouseFixture } from "../lib/club-repository";

const migration = readFileSync(new URL("../supabase/migrations/2026-09-04-club-product-entitlements.sql", import.meta.url), "utf8");

test("product entitlement definitions have lossless relational columns separate from issued grants", () => {
  const tableDefinition = migration.match(/create table public\.club_product_entitlements \(([\s\S]+?)\n\);/)?.[1] ?? "";
  for (const column of [
    "product_id", "organisation_id", "position", "entitlement_key", "scope", "location_ids",
    "allowance_quantity", "allowance_period", "discount_percent", "discount_period", "discount_max_uses",
  ]) assert.match(tableDefinition, new RegExp(`\\b${column}\\b`, "i"));
  assert.doesNotMatch(tableDefinition, /\b(?:user_id|membership_id|starts_at|ends_at|source)\b/i);
  assert.match(migration, /These rows describe benefits promised by products[\s\S]+issued benefits[\s\S]+club_entitlement_grants/i);
  assert.match(migration, /unique \(product_id, position\)/i);
});

test("product definitions enforce same-organisation products and stable entitlement invariants", () => {
  assert.match(migration, /foreign key \(product_id, organisation_id\)\s+references public\.club_products\(id, organisation_id\) on delete cascade/is);
  assert.match(migration, /scope in \('organisation', 'locations', 'future_locations'\)/i);
  assert.match(migration, /allowance_quantity is not null and allowance_quantity > 0 and allowance_period is not null and allowance_period in \('week', 'month', 'block'\)/i);
  assert.match(migration, /discount_percent > 0 and discount_percent <= 100/i);
  assert.match(migration, /discount_period is null or discount_period = 'month'/i);
  assert.match(migration, /discount_max_uses is null or discount_max_uses > 0/i);
});

test("product entitlement RLS is member-readable and admin-write-only within an organisation", () => {
  assert.match(migration, /alter table public\.club_product_entitlements enable row level security/i);
  assert.match(migration, /club_product_entitlements_member_select[\s\S]+for select to authenticated[\s\S]+array\['member','trainer','gym_staff','gym_admin','owner','guest'\]/i);
  for (const action of ["insert", "update", "delete"]) {
    const policy = migration.match(new RegExp(`create policy club_product_entitlements_admin_${action}[\\s\\S]+?;`, "i"))?.[0] ?? "";
    assert.match(policy, new RegExp(`for ${action} to authenticated`, "i"));
    assert.match(policy, /array\['gym_admin','owner'\]/i);
    assert.doesNotMatch(policy, /'(?:member|trainer|gym_staff|guest)'/i);
  }
  assert.doesNotMatch(migration, /for all|_self/i);
});

test("current product benefit shapes are representable and materialise independently per holder", async () => {
  const repository = new MemoryClubRepository();
  const products = await repository.listProducts(madhouseFixture.id);
  const byName = (name: string) => products.find(product => product.name === name)!;
  const golden = byName("Golden Ticket Founding Membership").entitlements!;
  assert.ok(golden.some(item => item.entitlementKey === "gym_access" && item.scope === "future_locations"));
  assert.ok(golden.some(item => item.discount?.percent === 20 && item.discount.period === "month" && item.discount.maxUses === 1));
  const transformation = byName("Transformation Gold").entitlements!;
  assert.ok(transformation.some(item => item.entitlementKey === "enhanced_training"));
  assert.ok(transformation.some(item => item.entitlementKey === "trainer_managed"));
  assert.ok(transformation.some(item => item.entitlementKey === "pt_session_credit" && item.allowance?.period === "week"));
  assert.deepEqual(byName("Standard Monthly").entitlements?.find(item => item.entitlementKey === "class_access")?.allowance, { quantity: 4, period: "month" });
  assert.deepEqual(byName("10 PT Session Block").entitlements?.[0].allowance, { quantity: 10, period: "block" });

  const result = await repository.assignProduct({ organisationId: madhouseFixture.id, productId: byName("Golden Ticket Founding Membership").id, userId: "holder-a", holderUserIds: ["holder-a", "holder-b"], source: "founding", validity: { startsAt: "2026-01-01" } });
  assert.equal(result.grants.length, golden.length * 2);
  for (const holder of ["holder-a", "holder-b"]) assert.deepEqual(result.grants.filter(grant => grant.userId === holder).map(grant => grant.entitlementKey), golden.map((definition: ProductEntitlement) => definition.entitlementKey));
});
