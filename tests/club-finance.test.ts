import test from "node:test";
import assert from "node:assert/strict";
import { calculateCommercialSettlement, financeCsv, monthRange, summariseStaffSettlement } from "../lib/club-finance";
import { hasClubCapability } from "../lib/club-capabilities";

test("commercial settlement makes money direction explicit", () => { assert.equal(calculateCommercialSettlement({ grossMinor: 10000, collector: "gym", staffRule: { kind: "percentage", basisPoints: 7000 } }).direction, "gym_pays_staff"); assert.equal(calculateCommercialSettlement({ grossMinor: 10000, collector: "staff", gymRule: { kind: "fixed", amountMinor: 3000 } }).direction, "staff_owes_gym"); });
test("missing agreement is unresolved, never guessed", () => assert.equal(calculateCommercialSettlement({ grossMinor: 1000, collector: "gym" }).unresolved, "commercial agreement required"));
test("staff settlement uses explicit direction", () => { const result = summariseStaffSettlement({ hoursMinor: 1000, ptPayableMinor: 2000, classPayableMinor: 0, gymCollectedForStaffMinor: 0, staffCollectedForGymMinor: 0, adjustmentsMinor: 0 }); assert.equal(result.direction, "gym_pays_staff"); assert.equal(summariseStaffSettlement({ ...result, hoursMinor: 0, ptPayableMinor: 0, staffCollectedForGymMinor: 5000 }).direction, "staff_owes_gym"); });
test("finance CSV is stable and safely escaped", () => { const csv = financeCsv([{ occurredAt: "2026-09-01", reference: "A,1", category: "Shop", grossMinor: 100, source: "order" }]); assert.match(csv, /"A,1"/); assert.equal(monthRange(2026, 9).from, "2026-09-01T00:00:00.000Z"); });
test("finance capabilities keep staff and management scopes separate", () => { assert.equal(hasClubCapability("gym_staff", "staff.work_submit"), true); assert.equal(hasClubCapability("gym_staff", "finance.view"), false); assert.equal(hasClubCapability("gym_admin", "finance.view"), true); });
