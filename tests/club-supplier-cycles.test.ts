import assert from "node:assert/strict";
import test from "node:test";
import { replenishmentQuantity, supplierCycleFor } from "@/lib/club-supplier-cycles";

test("replenishment accounts for inbound stock", () => { assert.equal(replenishmentQuantity(3, 5, 10, 0), 7); assert.equal(replenishmentQuantity(3, 5, 10, 3), 0); assert.equal(replenishmentQuantity(6, 5, 10, 0), 0); });
test("incomplete supplier schedule is truthful", () => { assert.match(supplierCycleFor(new Date(), { timezone: "Europe/London" }).message, /timing confirmed after order/); });
