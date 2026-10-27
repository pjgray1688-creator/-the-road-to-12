import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { allocateBundles, resolveQuantityPromotionStacking } from "@/lib/club-promotions";
import { allocateStripeCheckoutLines } from "@/lib/stripe-commerce-provider";

const migration = readFileSync(resolve("supabase/migrations/2027-01-20-madhouse-apparel-foundation.sql"), "utf8");
const manifest = JSON.parse(readFileSync(resolve("public/madhouse-apparel/image-manifest.json"), "utf8")) as { families: Record<string, Record<string, string[]>> };

test("reviewed apparel media covers all 21 colours and every deployed file", () => {
  const colourCount = Object.values(manifest.families).reduce((sum, colours) => sum + Object.keys(colours).length, 0);
  assert.equal(colourCount, 21);
  const files = new Set(readdirSync(resolve("public/madhouse-apparel")));
  for (const colours of Object.values(manifest.families)) for (const images of Object.values(colours)) for (const image of images) assert.ok(files.has(image), image);
  assert.equal(Object.values(manifest.families)[0] && Object.values(Object.values(manifest.families)[0]).every(images => images.length === 2), true);
});

test("import is exact, manual, idempotent and never creates inventory", () => {
  assert.match(migration, /variant_count<>168/);
  assert.match(migration, /array\['S','M','L','XL','2XL','3XL','4XL','5XL'\]/);
  assert.match(migration, /availability_source":"manual"/);
  assert.match(migration, /stock_tracked[^\n]+false/);
  assert.match(migration, /on conflict \(organisation_id,supplier_id,supplier_sku\)/);
  assert.doesNotMatch(migration, /insert into public\.club_inventory|insert into public\.club_stock_movements/);
});

test("winter bundle repeats and Golden Ticket uses only an unbundled tee", () => {
  const lines = [{ id: "hoodie", productId: "hoodie", unitPriceMinor: 3500, quantity: 1 }, { id: "tee", productId: "tee", unitPriceMinor: 2500, quantity: 2 }];
  const bundle = allocateBundles(lines, [{ required: 1, productIds: ["hoodie"] }, { required: 1, productIds: ["tee"] }], 4750, true);
  assert.equal(bundle.bundleCount, 1); assert.equal(bundle.savingMinor, 1250);
  const applied = resolveQuantityPromotionStacking([
    { id: "winter", savingMinor: 1250, priority: 500, consumed: [{ lineId: "hoodie", quantity: 1 }, { lineId: "tee", quantity: 1 }] },
    { id: "golden", savingMinor: 1200, priority: 0, consumed: [{ lineId: "hoodie", quantity: 1, unitPriceMinor: 3500 }, { lineId: "tee", quantity: 2, unitPriceMinor: 2500 }], percentageBasisPoints: 2000 },
  ], { hoodie: 1, tee: 2 });
  assert.deepEqual(applied.map(item => [item.id, item.savingMinor]), [["winter", 1250], ["golden", 500]]);
});

test("fully bundled quantities produce no Golden Ticket saving", () => {
  const applied = resolveQuantityPromotionStacking([
    { id: "winter", savingMinor: 1250, priority: 500, consumed: [{ lineId: "hoodie", quantity: 1 }, { lineId: "tee", quantity: 1 }] },
    { id: "golden", savingMinor: 1200, priority: 0, consumed: [{ lineId: "hoodie", quantity: 1 }, { lineId: "tee", quantity: 1 }], percentageBasisPoints: 2000 },
  ], { hoodie: 1, tee: 1 });
  assert.deepEqual(applied.map(item => item.id), ["winter"]);
});

test("Stripe dynamic price data is allocated to the authoritative discounted total", () => {
  const allocated = allocateStripeCheckoutLines([{ productId: "hoodie", productName: "Pullover Hoodie", quantity: 1, unitPriceMinor: 3500, currency: "GBP" }, { productId: "tee", productName: "Heavy Oversized T-Shirt", quantity: 1, unitPriceMinor: 2500, currency: "GBP" }], 4750);
  assert.equal(allocated.reduce((sum, line) => sum + line.checkoutUnitPriceMinor * line.quantity, 0), 4750);
  assert.ok(allocated.every(line => line.checkoutUnitPriceMinor > 0));
});

test("database authority protects import, toggle, checkout and demand identity", () => {
  assert.match(migration, /security definer set search_path=pg_catalog,public/g);
  assert.match(migration, /club_capability_allowed\(p_organisation_id,auth\.uid\(\),'supplier\.catalogue_manage'\)/);
  assert.match(migration, /club_guard_supplier_order_item/);
  assert.match(migration, /sp\.club_product_id=new\.product_id/);
  assert.match(migration, /stripe_merchant_entity='madhouse_products_services'/);
  assert.match(migration, /o\.total_minor<>v_expected-o\.discount_minor/);
  assert.match(migration, /effect_type'',''percentage/);
});
