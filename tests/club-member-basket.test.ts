import assert from "node:assert/strict";
import test from "node:test";
import { memberBasketStorageKey, sanitiseMemberBasket } from "@/lib/club-member-basket";

test("basket intent is scoped and sanitised", () => { assert.equal(memberBasketStorageKey("org-a", "user-a"), "r12:member-basket:org-a:user-a"); assert.deepEqual(sanitiseMemberBasket({ good: 2, stale: 1, bad: 0 }, new Set(["good"])), { good: 2 }); });
test("basket rejects malformed quantities and keeps no price data", () => { assert.deepEqual(sanitiseMemberBasket({ item: 1.2, other: -1, ok: 3 }), { ok: 3 }); });
