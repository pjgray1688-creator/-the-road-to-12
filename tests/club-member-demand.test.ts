import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allocateReceivedUnits, availableToSellAfterMemberAllocation, collectionLabelData, collectionQrReference, snapshotMemberSupplierOrderLine, supplierRequirementLines, supplierVariantCanBeOrdered } from "../lib/club-supplier-workflow";
import { groupSupplierCatalogue, parseSupplierCatalogueRows, resolveSupplierProductImage, resolveSupplierVariantReference, upsertSupplierCatalogue, variantsForSize, type SupplierCatalogueStore } from "../lib/club-supplier-catalogue";

test("supplier requirements keep committed member demand separate from replenishment", () => {
  assert.deepEqual(supplierRequirementLines({ supplierId: "active", replenishment: [{ supplierVariantKey: "v", quantity: 3 }], committed: [{ supplierVariantKey: "v", quantity: 2 }] }), [{ supplierId: "active", supplierVariantKey: "v", replenishmentQuantity: 3, committedMemberQuantity: 2, totalRequired: 5 }]);
});
test("received units allocate oldest member demand before general stock", () => {
  const result = allocateReceivedUnits([{ id: "older", supplierVariantKey: "v", quantityRequired: 1, quantityAllocated: 0, createdAt: "2026-01-01" }, { id: "newer", supplierVariantKey: "v", quantityRequired: 1, quantityAllocated: 0, createdAt: "2026-01-02" }], "v", 2);
  assert.deepEqual(result.allocations, [{ demandId: "older", quantity: 1 }, { demandId: "newer", quantity: 1 }]); assert.equal(result.uncommittedQuantity, 0);
});
test("partial receipts leave uncommitted quantity at zero and use opaque collection references", () => {
  const result = allocateReceivedUnits([{ id: "d", supplierVariantKey: "v", quantityRequired: 2, quantityAllocated: 0, createdAt: "2026-01-01" }], "v", 1); assert.deepEqual(result.allocations, [{ demandId: "d", quantity: 1 }]); assert.equal(result.uncommittedQuantity, 0); const qr = collectionQrReference("org", "order", "item"); assert.match(qr, /^r12col_/); assert.doesNotMatch(qr, /org|order|item/);
});
test("supplier member-orderability requires available stock and a Madhouse retail price", () => {
  const variant = { supplierId: "active", parentKey: "p", stockStatus: "available" } as any; assert.equal(supplierVariantCanBeOrdered({ memberOrderable: true }, variant, true), true); assert.equal(supplierVariantCanBeOrdered({ memberOrderable: true }, { ...variant, stockStatus: "unknown" }, true), false); assert.equal(supplierVariantCanBeOrdered({ memberOrderable: false }, variant, true), false); assert.equal(supplierVariantCanBeOrdered({ memberOrderable: true }, variant, false), false);
});
test("exact variant options remain grouped and size filtering never invents combinations", () => {
  const product = { parentKey: "abe", supplierId: "active", name: "ABE", variants: [{ supplierId: "active", parentKey: "abe", size: "1kg", flavour: "Chocolate", stockStatus: "available" as const }, { supplierId: "active", parentKey: "abe", size: "2kg", flavour: "Cherry", stockStatus: "available" as const }] };
  assert.equal(variantsForSize(product, "1kg").map(v => v.flavour).join(), "Chocolate");
  assert.equal(variantsForSize(product, "1kg").some(v => v.flavour === "Cherry"), false);
});
test("receiving references resolve by unique supplier SKU, barcode, then canonical id", () => {
  const variants = [{ canonicalVariantId: "v1", supplierSku: "SKU1", barcode: "111" }, { canonicalVariantId: "v2", supplierSku: "SKU2", barcode: "222" }];
  assert.equal(resolveSupplierVariantReference({ supplierSku: "SKU2" }, variants)?.canonicalVariantId, "v2");
  assert.equal(resolveSupplierVariantReference({ barcode: "111" }, variants)?.canonicalVariantId, "v1");
});
test("member allocation is excluded from customer available-to-sell", () => assert.equal(availableToSellAfterMemberAllocation(5, 0, 2), 3));
test("order-line snapshot and collection label preserve exact identity while QR stays opaque", () => {
  const line = snapshotMemberSupplierOrderLine({ canonicalProductId: "p", canonicalVariantId: "v", supplierId: "active", supplierVariantReference: "SKU", size: "2kg", flavour: "Cherry", memberFacingProductName: "Beef XP", retailPriceMinor: 3000, quantity: 1 });
  assert.equal(line.fulfilmentType, "MEMBER_SUPPLIER_ORDER");
  const label = collectionLabelData({ memberDisplayName: "Member", orderReference: "R12-1", productName: "Beef XP", quantity: 1, locationName: "Rotherham", organisationId: "org", orderId: "order", orderItemId: "item" });
  assert.match(label.qrReference, /^r12col_/); assert.doesNotMatch(label.qrReference, /Member|org|order|item/); assert.notEqual(collectionQrReference("org", "order", "item"), "");
});
test("supplier CSV upsert is idempotent and does not require a price", () => {
  const supplier = { id: "active", name: "Active Sports", memberOrderable: true };
  const rows = parseSupplierCatalogueRows("supplier,brand,parent_product,size,variant,pack_quantity,supplier_sku,availability,parent_image_url,variant_image_url\nActive Sports,Applied Nutrition,Beef XP,1kg,Chocolate,1,SKU-1,available,https://img/parent.jpg,https://img/variant.jpg\nActive Sports,Applied Nutrition,Beef XP,2kg,Cherry Slush,1,SKU-2,available,https://img/parent.jpg,", supplier);
  const store: SupplierCatalogueStore = { suppliers: [], products: [], retailPrices: {} };
  const first = upsertSupplierCatalogue(store, rows, supplier); const second = upsertSupplierCatalogue(store, rows, supplier);
  assert.equal(store.products.length, 1); assert.equal(store.products[0].variants.length, 2); assert.equal(first.created, 3); assert.equal(second.unchanged, 1);
  assert.equal(resolveSupplierProductImage(store.products[0], store.products[0].variants[0]), "https://img/variant.jpg");
});
test("supplier promo boilerplate is excluded while parent remains grouped", () => {
  const supplier = { id: "active", name: "Active Sports", memberOrderable: true };
  const rows = parseSupplierCatalogueRows("name,parent_key,variant,size,availability\nBeef XP | SPECIAL OFFER | FREE SHAKER,beef-xp,Chocolate,1kg,available\nBeef XP | BLACK FRIDAY,beef-xp,Vanilla,2kg,available", supplier);
  const grouped = groupSupplierCatalogue(rows, supplier); assert.equal(grouped.length, 1); assert.equal(grouped[0].name, "Beef XP"); assert.equal(grouped[0].variants.length, 2);
});
test("durable catalogue migration contains parent, variant metadata, retail mapping and guarded importer", () => {
  const sql = readFileSync("supabase/migrations/2026-10-13-club-supplier-catalogue-parent-variants.sql", "utf8");
  for (const term of ["club_supplier_parent_products", "parent_product_id", "pack_quantity", "member_orderable_unit", "availability_checked_at", "variant_image_url", "club_supplier_variant_prices", "club_import_supplier_catalogue_v2", "supplier.catalogue_manage", "p_reconcile boolean default false"]) assert.match(sql, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(sql, /wholesale_cost_minor[^\n]*p_rows/);
});
