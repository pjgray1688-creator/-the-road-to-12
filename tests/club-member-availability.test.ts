import test from "node:test";
import assert from "node:assert/strict";
import { memberAvailabilityLabel, memberProductFulfilmentLabel, resolveMemberProductAvailability } from "../lib/club-member-availability";

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

test("fulfilment labels distinguish local stock from supplier ordering", () => {
  assert.equal(memberAvailabilityLabel("IN_GYM"), "In gym now");
  assert.equal(memberAvailabilityLabel("SUPPLIER_ORDER"), "Available to order");
  assert.equal(memberAvailabilityLabel("UNAVAILABLE"), "Unavailable");
  assert.equal(memberProductFulfilmentLabel("SUPPLIER_ORDER", true), "Made to order");
  assert.equal(memberProductFulfilmentLabel("SUPPLIER_ORDER"), "Available to order");
  assert.equal(memberProductFulfilmentLabel("IN_GYM"), "In gym now");
});
