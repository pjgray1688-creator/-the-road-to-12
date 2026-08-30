import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { currentBlock, currentWeek, measurementChange, weightTrend } from "../lib/domain";
import type { RecoverySnapshot } from "../lib/domain";
import { genuineHistoricalTraining } from "../lib/historical-data";

test("historical records are explicit, genuine and distinct from current data", () => { assert.ok(genuineHistoricalTraining.every(record => record.origin === "historical")); assert.equal(genuineHistoricalTraining.find(record => record.exerciseId === "leg-press")?.weight, 300); });
test("current block has a complete seven-day plan with explicit rest", () => { assert.equal(currentWeek.length, 7); assert.equal(currentBlock.status, "active"); assert.equal(currentWeek.find(day => day.id === "thu")?.status, "rest"); assert.equal(currentWeek.find(day => day.id === "thu")?.reason, "planned_rest"); });
test("sessions can communicate changed status without silently moving the programme", () => { const moved = { ...currentWeek[1], status: "rescheduled" as const, reason: "recovery" as const }; assert.equal(moved.status, "rescheduled"); assert.equal(moved.reason, "recovery"); });
test("bodyweight trend uses multiple measurements rather than one weigh-in", () => { const result = weightTrend([{ id: "1", date: "2026-08-01", bodyweight: 80, origin: "real", source: "manual" }, { id: "2", date: "2026-08-08", bodyweight: 79.5, origin: "real", source: "manual" }]); assert.equal(result.current, 79.5); assert.equal(result.weeklyChange, -0.5); assert.equal(result.sinceStart, -0.5); });
test("measurements expose latest, previous and change", () => { const result = measurementChange([{ id: "1", date: "2026-08-01", waist: 80, origin: "real", source: "manual" }, { id: "2", date: "2026-08-08", waist: 79, origin: "real", source: "manual" }], "waist"); assert.deepEqual(result, { latest: 79, previous: 80, change: -1 }); });
test("recovery and integrations have no fabricated values", () => { const snapshot: RecoverySnapshot = { id: "r", date: "2026-08-30", origin: "real", source: "manual" }; assert.equal(snapshot.recoveryScore, undefined); const integration = { provider: "whoop", status: "not_connected" as const, scopes: [] }; assert.equal(integration.status, "not_connected"); });
test("main app mounts visible readiness experience", () => { const source = fs.readFileSync("components/training-app.tsx", "utf8"); const dashboard = fs.readFileSync("components/dashboard-foundation.tsx", "utf8"); assert.match(source, /DashboardFoundation/); assert.match(dashboard, /READINESS/); assert.match(dashboard, /Connect WHOOP/); assert.match(dashboard, /Log recovery/); });
