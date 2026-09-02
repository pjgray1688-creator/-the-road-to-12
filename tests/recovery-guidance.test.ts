import test from "node:test";
import assert from "node:assert/strict";
import { recoveryGuidance } from "../lib/recovery-guidance";

const snapshot = (date: string, recoveryScore: number) => ({ id: date, date, origin: "real" as const, source: "whoop" as const, recoveryScore });
test("recovery guidance follows deterministic bands", () => { assert.equal(recoveryGuidance([snapshot("2026-09-02", 20)], "2026-09-02").band, "low"); assert.equal(recoveryGuidance([snapshot("2026-09-02", 40)], "2026-09-02").band, "caution"); assert.equal(recoveryGuidance([snapshot("2026-09-02", 60)], "2026-09-02").band, "moderate"); assert.equal(recoveryGuidance([snapshot("2026-09-02", 75)], "2026-09-02").band, "good"); assert.equal(recoveryGuidance([snapshot("2026-09-02", 85)], "2026-09-02").band, "strong"); });
test("recovery guidance recognises improving and declining context", () => { const improving = recoveryGuidance([snapshot("2026-09-01", 19), snapshot("2026-09-02", 51)], "2026-09-02"); assert.equal(improving.trend, "improving"); assert.match(improving.message, /right direction/); const declining = recoveryGuidance([snapshot("2026-08-31", 80), snapshot("2026-09-01", 78), snapshot("2026-09-02", 51)], "2026-09-02"); assert.equal(declining.trend, "declining"); assert.match(declining.message, /dipped/); });
test("recovery guidance remains honest when history is unavailable", () => { const result = recoveryGuidance([], "2026-09-02"); assert.equal(result.band, "unknown"); assert.match(result.message, /No recovery score/); });
