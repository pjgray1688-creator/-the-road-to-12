import test from "node:test";
import assert from "node:assert/strict";
import { appendBodyMetric, latestMeasurement, measurementDelta, measurementEntries, progressPhotoAvailability, removeBodyMetric, weightSummary } from "../lib/progress";
import type { BodyMeasurement } from "../lib/domain";
import type { AppData } from "../lib/types";

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
