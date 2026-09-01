import type { BodyMeasurement, BodyMeasurementType } from "./domain";
import type { AppData } from "./types";

export const measurementLabels: Record<BodyMeasurementType, string> = {
  waist_navel: "Waist at navel", waist_trouser: "Lower waist / trouser line", chest: "Chest", shoulders: "Shoulders",
  upper_arm_left: "Left upper arm", upper_arm_right: "Right upper arm", thigh_left: "Left thigh", thigh_right: "Right thigh", calf_left: "Left calf", calf_right: "Right calf",
};
export const measurementGuidance: Partial<Record<BodyMeasurementType, string>> = {
  waist_navel: "Measure horizontally around the level of your belly button.",
  waist_trouser: "Use the same trouser-line position each time.",
  chest: "Measure around the fullest part, keeping the tape level.",
  shoulders: "Measure around the broadest shoulder position consistently.",
};

export type MeasurementEntry = { id: string; date: string; type: BodyMeasurementType; value: number; unit: "cm" };
const legacyMap: Array<[keyof BodyMeasurement, BodyMeasurementType]> = [["waist", "waist_navel"], ["chest", "chest"], ["thigh", "thigh_left"], ["upperArm", "upper_arm_left"]];

export function measurementEntries(items: BodyMeasurement[]): MeasurementEntry[] {
  return items.filter(item => item.origin !== "test").flatMap(item => {
    if (item.measurementType && typeof item.value === "number" && item.value > 0) return [{ id: item.id, date: item.date, type: item.measurementType, value: item.value, unit: "cm" as const }];
    return legacyMap.flatMap(([field, type]) => typeof item[field] === "number" && item[field]! > 0 ? [{ id: `${item.id}:${type}`, date: item.date, type, value: item[field]!, unit: "cm" as const }] : []);
  }).sort((a, b) => `${b.date}${b.id}`.localeCompare(`${a.date}${a.id}`));
}

export function validWeights(items: BodyMeasurement[]) {
  return items.filter(item => item.origin !== "test" && typeof item.bodyweight === "number" && item.bodyweight > 0).sort((a, b) => `${a.date}${a.time ?? ""}`.localeCompare(`${b.date}${b.time ?? ""}`));
}

export function weightSummary(items: BodyMeasurement[]) {
  const weights = validWeights(items);
  const latest = weights.at(-1)?.bodyweight;
  const previous = weights.at(-2)?.bodyweight;
  const window = weights.slice(-7);
  const rollingAverage = window.length >= 3 ? window.reduce((sum, item) => sum + (item.bodyweight ?? 0), 0) / window.length : undefined;
  return { entries: weights, latest, previous, change: latest !== undefined && previous !== undefined ? latest - previous : undefined, rollingAverage };
}

export function latestMeasurement(items: BodyMeasurement[], type: BodyMeasurementType) {
  return measurementEntries(items).find(item => item.type === type);
}

export function measurementDelta(items: BodyMeasurement[], type: BodyMeasurementType) {
  const values = measurementEntries(items).filter(item => item.type === type);
  return values.length > 1 ? values[0].value - values[1].value : undefined;
}

export function appendBodyMetric(data: AppData, item: BodyMeasurement): AppData { return { ...data, bodyMetrics: [item, ...data.bodyMetrics.filter(existing => existing.id !== item.id)] }; }
export function removeBodyMetric(data: AppData, id: string): AppData { return { ...data, bodyMetrics: data.bodyMetrics.filter(item => item.id !== id) }; }

export const progressPhotoAvailability = { available: false, message: "Private progress photos are not connected yet." } as const;
