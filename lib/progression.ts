import type { Exercise, LoadUnit, LoadingProfileKind } from "./types";
function increment(exercise: Exercise) { return exercise.equipment === "dumbbell" ? 2 : exercise.equipment === "barbell" ? 2.5 : exercise.stackIncrement ?? (exercise.equipment === "machine" ? 5 : 2.5); }
function practical(value: number, exercise: Exercise, direction: "up" | "down" = "up") { const step = increment(exercise); const units = value / step; return Math.max(step, Math.round((direction === "up" ? Math.ceil(units) : Math.floor(units)) * step * 100) / 100); }
function snap(value: number, exercise: Exercise, direction: "up" | "down" = "up") { const values = exercise.validLoads?.slice().sort((a, b) => a - b); if (!values?.length) return practical(value, exercise, direction); return direction === "up" ? values.find(item => item >= value) ?? values.at(-1)! : [...values].reverse().find(item => item <= value) ?? values[0]; }
function next(value: number, exercise: Exercise) { return snap(value + increment(exercise), exercise, "up"); }
export type ProgressionProfile = { kind: "dumbbell" | "barbell" | "selectorised_machine" | "plate_loaded_machine"; category: LoadingProfileKind; unit: LoadUnit; baseIncrement: number; rampStyle: "proportional" | "plate_jump" | "small_step"; rampBudget: number; };
export function progressionProfile(exercise: Exercise): ProgressionProfile {
  const category = exercise.loadingProfile ?? (exercise.loadProfile === "plate_loaded" || exercise.id === "leg-press"
    ? (exercise.equipment === "barbell" ? "heavy_plate_compound" : "heavy_machine_compound")
    : exercise.loadProfile === "selectorised" && exercise.equipment === "machine" && exercise.defaultWorkingWeight === 0
      ? "bodyweight_assisted"
      : exercise.purpose === "isolation" || exercise.purpose === "core"
        ? (exercise.equipment === "dumbbell" ? "dumbbell_isolation" : "cable_machine_isolation")
        : exercise.equipment === "dumbbell" ? "dumbbell_compound"
          : exercise.equipment === "barbell" ? "heavy_plate_compound"
            : exercise.equipment === "machine" ? "selectorised_compound" : "generic_load");
  const kind = category === "heavy_plate_compound" ? "barbell" : category === "heavy_machine_compound" ? "plate_loaded_machine" : category === "dumbbell_compound" || category === "dumbbell_isolation" ? "dumbbell" : "selectorised_machine";
  const unit: LoadUnit = exercise.loadUnit ?? (category === "dumbbell_compound" || category === "dumbbell_isolation" ? "per_hand" : category === "bodyweight_assisted" ? "assistance" : category === "cable_machine_isolation" || category === "selectorised_compound" || category === "heavy_machine_compound" ? "stack" : "total");
  const baseIncrement = category === "heavy_machine_compound" ? exercise.stackIncrement ?? 20 : category === "heavy_plate_compound" ? 2.5 : category === "dumbbell_compound" || category === "dumbbell_isolation" ? 2 : category === "bodyweight_assisted" ? 1 : exercise.stackIncrement ?? (category === "selectorised_compound" ? 5 : 2.5);
  const rampStyle = category === "heavy_plate_compound" || category === "heavy_machine_compound" ? "plate_jump" : category === "bodyweight_assisted" ? "small_step" : "small_step";
  const rampBudget = category === "heavy_plate_compound" ? 3 : category === "heavy_machine_compound" ? 2 : category === "dumbbell_compound" ? 2 : category === "selectorised_compound" ? 1 : 1;
  return { kind, category, unit, baseIncrement, rampStyle, rampBudget };
}
export function rampBudgetFor(exercise: Exercise, establishedHistory = false) { const profile = progressionProfile(exercise); return Math.max(1, profile.rampBudget - (establishedHistory ? 1 : 0)); }
export function rampRepTarget(exercise: Exercise, rampNumber: number, nearTarget = false) { const category = progressionProfile(exercise).category; if (category === "heavy_plate_compound" || category === "heavy_machine_compound") return rampNumber <= 1 ? "5–8" : nearTarget ? "1–3" : "3–5"; if (category === "dumbbell_compound" || category === "selectorised_compound") return rampNumber <= 1 ? "5–8" : "3–5"; return "8–12"; }
export function defaultWorkingRepRange(exercise: Exercise) { const numeric = exercise.target.match(/\d+\s*[×x]\s*(\d+(?:[–-]\d+)?)/i)?.[1]; if (numeric) return numeric.replace(/-/g, "–"); const category = progressionProfile(exercise).category; return category === "heavy_plate_compound" || category === "heavy_machine_compound" ? "5–8" : category === "dumbbell_compound" || category === "selectorised_compound" ? "8–12" : "10–15"; }
export function magnitudeLoad(exercise: Exercise, weight: number, reps: number, targetHigh: number, rir?: number) { const profile = progressionProfile(exercise); if ((rir ?? 0) < 3 || reps < targetHigh) return next(weight, exercise); const excess = Math.max(0, reps - targetHigh); const jumps = profile.category === "dumbbell_compound" ? Math.min(3, 1 + Math.floor(excess / 4)) : profile.category === "dumbbell_isolation" ? 1 : profile.category === "heavy_machine_compound" ? Math.min(2, 1 + Math.floor(excess / 5)) : 1; let result = weight; for (let i = 0; i < jumps; i++) result = next(result, exercise); return result; }
export function workingLoadIncrease(exercise: Exercise, weight: number, rir?: number) {
  const profile = progressionProfile(exercise);
  if (profile.category === "heavy_plate_compound" || profile.category === "heavy_machine_compound") {
    const nearTop = weight >= exercise.defaultWorkingWeight * 1.2;
    const effort = rir ?? 0;
    const jump = effort >= 4 ? 10 : nearTop && effort >= 3 ? 2.5 : 5;
    return snap(weight + jump, exercise, "up");
  }
  return next(weight, exercise);
}
export function rampLoad(exercise: Exercise, current: number, target: number) { const profile = progressionProfile(exercise); if (profile.rampStyle === "plate_jump") { const distance = Math.max(0, target - current); const jump = distance >= target * .5 ? 40 : distance >= target * .2 ? 20 : distance >= target * .1 ? 10 : 5; return Math.min(target, snap(current + jump, exercise, "up")); } return Math.min(target, next(current, exercise)); }
