import test from "node:test";
import assert from "node:assert/strict";
import { resolveMemberProductAvailability } from "../lib/club-member-availability";

test("customer availability treats zero and negative stock as unavailable locally", () => {
  assert.equal(resolveMemberProductAvailability({ availableLocalQuantity: 5, supplierOrderable: true }), "IN_GYM");
  assert.equal(resolveMemberProductAvailability({ availableLocalQuantity: 1, supplierOrderable: false }), "IN_GYM");
  assert.equal(resolveMemberProductAvailability({ availableLocalQuantity: 0, supplierOrderable: true }), "SUPPLIER_ORDER");
  assert.equal(resolveMemberProductAvailability({ availableLocalQuantity: -3, supplierOrderable: true }), "SUPPLIER_ORDER");
  assert.equal(resolveMemberProductAvailability({ availableLocalQuantity: 0, supplierOrderable: false }), "UNAVAILABLE");
  assert.equal(resolveMemberProductAvailability({ availableLocalQuantity: -3, supplierOrderable: false }), "UNAVAILABLE");
});

test("missing location availability never claims in-gym stock", () => {
  assert.equal(resolveMemberProductAvailability({ supplierOrderable: true }), "SUPPLIER_ORDER");
});
