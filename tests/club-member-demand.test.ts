import test from "node:test";
import assert from "node:assert/strict";
import { allocateReceivedUnits, availableToSellAfterMemberAllocation, collectionLabelData, collectionQrReference, snapshotMemberSupplierOrderLine, supplierRequirementLines, supplierVariantCanBeOrdered } from "../lib/club-supplier-workflow";
import { resolveSupplierVariantReference, variantsForSize } from "../lib/club-supplier-catalogue";

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
