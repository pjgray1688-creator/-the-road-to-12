import test from "node:test";
import assert from "node:assert/strict";
import { collectionReady, fulfilmentForProduct, paidSupplierDemand } from "../lib/club-supplier-workflow";
test("supplier availability never masquerades as local stock", () => { const product = { stockTracked: true } as any; assert.equal(fulfilmentForProduct(product, undefined), "available_to_order"); assert.equal(fulfilmentForProduct(product, 2), "in_gym_now"); });
test("only paid orders create supplier demand", () => { const order = { id: "o1", status: "paid", items: [{ id: "i1", productId: "p1", quantity: 2 }] } as any; assert.equal(paidSupplierDemand(order, false, new Set(["p1"])).length, 0); assert.equal(paidSupplierDemand(order, true, new Set(["p1"]))[0].quantity, 2); });
test("collection is ready only after received and allocated", () => { assert.equal(collectionReady(2, 2, 1), false); assert.equal(collectionReady(2, 2, 2), true); });
