import test from "node:test";
import assert from "node:assert/strict";
import { appendBodyMetric, latestMeasurement, measurementDelta, measurementEntries, progressPhotoAvailability, removeBodyMetric, weightSummary } from "../lib/progress";
import type { BodyMeasurement } from "../lib/domain";
import type { AppData } from "../lib/types";
import { cmToIn, defaultBodyUnits, displayCircumference, displayWeight, formatDisplayDate, inToCm, kgToLb, lbToKg } from "../lib/locale";
import fs from "node:fs";

const metric = (id: string, date: string, bodyweight?: number): BodyMeasurement => ({ id, date, bodyweight, origin: "real", source: "manual" });
const data: AppData = { version: 2, workouts: [], bodyMetrics: [], meals: [] };

test("weight summary orders entries and only shows a rolling trend with enough observations", () => {
  const summary = weightSummary([metric("2", "2026-09-02", 79), metric("1", "2026-09-01", 80)]);
  assert.equal(summary.latest, 79); assert.equal(summary.change, -1); assert.equal(summary.rollingAverage, undefined);
  assert.equal(weightSummary([...Array.from({ length: 3 }, (_, i) => metric(String(i), `2026-09-0${i + 1}`, 80 - i))]).rollingAverage, 79);
});

test("structured measurements support individual logging and comparable change", () => {
  const items: BodyMeasurement[] = [
    { id: "new", date: "2026-09-02", origin: "real", source: "manual", measurementType: "waist_navel", value: 82, unit: "cm" },
    { id: "old", date: "2026-09-01", origin: "real", source: "manual", measurementType: "waist_navel", value: 84, unit: "cm" },
  ];
  assert.equal(latestMeasurement(items, "waist_navel")?.value, 82); assert.equal(measurementDelta(items, "waist_navel"), -2); assert.equal(measurementEntries(items).length, 2);
});

test("test-origin metrics are excluded and corrections are scoped to body metrics", () => {
  const testItem = metric("test", "2026-09-03", 100); testItem.origin = "test";
  const next = appendBodyMetric(data, metric("real", "2026-09-03", 80));
  assert.equal(weightSummary([testItem, ...next.bodyMetrics]).entries.length, 1);
  assert.equal(removeBodyMetric(next, "real").bodyMetrics.length, 0); assert.equal(next.workouts.length, 0);
});

test("photo infrastructure exposes an intentional private unavailable state", () => { assert.equal(progressPhotoAvailability.available, false); assert.match(progressPhotoAvailability.message, /private/i); });
test("locale-aware formatting avoids raw ISO dates and supports both locales", () => { assert.equal(formatDisplayDate("2026-09-01", "en-GB"), "1 Sept 2026"); assert.equal(formatDisplayDate("2026-09-01", "en-US"), "Sep 1, 2026"); assert.match(displayWeight(80, "kg", "en-GB"), /80 kg/); assert.match(displayWeight(80, "lb", "en-US"), /176\.4 lb/); assert.match(displayCircumference(107, "in", "en-US"), /42\.1 in/); });
test("body-unit conversion preserves canonical values and locale defaults are overridable", () => { assert.ok(Math.abs(lbToKg(220.4623) - 100) < .01); assert.ok(Math.abs(kgToLb(100) - 220.4623) < .01); assert.ok(Math.abs(inToCm(42.126) - 107) < .01); assert.ok(Math.abs(cmToIn(107) - 42.126) < .01); assert.deepEqual(defaultBodyUnits("en-US"), { weight: "lb", circumference: "in" }); assert.deepEqual(defaultBodyUnits("en-GB"), { weight: "kg", circumference: "cm" }); });
test("Progress uses compact disclosures, safe-area padding and app-styled picker", () => { const source = fs.readFileSync("app/progress/page.tsx", "utf8"); const css = fs.readFileSync("app/training-polish.css", "utf8"); assert.match(source, /compact-action/); assert.match(source, /picker-trigger/); assert.match(source, /formatDisplayDate/); assert.doesNotMatch(source, /Back to Training/); assert.match(css, /safe-area-inset-top/); assert.match(css, /option-sheet/); });
