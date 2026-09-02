import type { Exercise } from "./types";
import { exerciseLibrary } from "./exercise-library";

export const COMMERCIAL_CABLE_STACK_LOADS = [9, 14, 18, 23, 27, 32, 36, 41, 45, 50, 55, 59, 64, 68, 73, 77, 82];
export const mondayExercises: Exercise[] = [
  { id: "incline-db-press", name: "Incline DB Press", target: "4 × 8–10", sets: 4, restSeconds: 120, purpose: "strength", equipment: "dumbbell", defaultWorkingWeight: 30 },
  { id: "machine-chest-press", name: "Machine Chest Press", target: "3 × 10–12", sets: 3, restSeconds: 105, purpose: "hypertrophy", equipment: "machine", stackIncrement: 5, defaultWorkingWeight: 80 },
  { id: "seated-db-shoulder-press", name: "Seated DB Shoulder Press", target: "3 × 8–10", sets: 3, restSeconds: 120, purpose: "strength", equipment: "dumbbell", defaultWorkingWeight: 20 },
  { id: "cable-lateral-raise", name: "Cable Lateral Raise", target: "4 × 12–15", sets: 4, restSeconds: 60, purpose: "isolation", equipment: "cable", stackIncrement: 2.5, validLoads: COMMERCIAL_CABLE_STACK_LOADS, defaultWorkingWeight: 14 },
  { id: "rope-triceps-pushdown", name: "Cable/Rope Triceps Pushdown", target: "4 × 10–15", sets: 4, restSeconds: 75, purpose: "isolation", equipment: "cable", stackIncrement: 2.5, validLoads: COMMERCIAL_CABLE_STACK_LOADS, defaultWorkingWeight: 55 },
  { id: "overhead-cable-triceps-extension", name: "Overhead Cable Triceps Extension", target: "3 × 12", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "cable", stackIncrement: 2.5, validLoads: COMMERCIAL_CABLE_STACK_LOADS, defaultWorkingWeight: 27 },
  { id: "cable-crunch", name: "Cable Crunch", target: "3 × 12–15", sets: 3, restSeconds: 60, purpose: "core", equipment: "cable", stackIncrement: 2.5, validLoads: COMMERCIAL_CABLE_STACK_LOADS, defaultWorkingWeight: 77 },
];
const additionalExercises: Exercise[] = [
  { id: "trap-bar-deadlift", name: "Trap-Bar Deadlift", target: "3 × 5–6", sets: 3, restSeconds: 180, purpose: "strength", equipment: "barbell", loadingProfile: "heavy_plate_compound", loadUnit: "total", defaultWorkingWeight: 80 },
  { id: "leg-press", name: "Leg Press", target: "4 × 10", sets: 4, restSeconds: 150, purpose: "strength", equipment: "machine", loadProfile: "plate_loaded", defaultWorkingWeight: 120 },
  { id: "hack-squat", name: "Hack Squat", target: "3 × 8–12", sets: 3, restSeconds: 150, purpose: "strength", equipment: "machine", loadProfile: "plate_loaded", defaultWorkingWeight: 80 },
  { id: "rdl", name: "Romanian Deadlift", target: "4 × 8–10", sets: 4, restSeconds: 150, purpose: "strength", equipment: "barbell", defaultWorkingWeight: 60 },
  { id: "hamstring-curl", name: "Seated Hamstring Curl", target: "4 × 10–15", sets: 4, restSeconds: 90, purpose: "hypertrophy", equipment: "machine", defaultWorkingWeight: 40 },
  { id: "leg-extension", name: "Leg Extension", target: "3 × 12–15", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "machine", defaultWorkingWeight: 40 },
  { id: "vertical-pull", name: "Pull-up / Assisted Pull-up", target: "performance-based reps", sets: 4, restSeconds: 120, purpose: "strength", equipment: "machine", loadingProfile: "bodyweight_assisted", loadUnit: "assistance", defaultWorkingWeight: 0 },
  { id: "barbell-row", name: "Barbell Row", target: "4 × 8", sets: 4, restSeconds: 120, purpose: "strength", equipment: "barbell", defaultWorkingWeight: 60 },
  { id: "lat-pullover", name: "Lat Pullover", target: "3 × 12", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "cable", defaultWorkingWeight: 35 },
  { id: "calves", name: "Calf Raise", target: "5 × 15", sets: 5, restSeconds: 75, purpose: "isolation", equipment: "machine", defaultWorkingWeight: 60 },
  { id: "flat-bench", name: "Flat Bench Press", target: "4 × 6–8", sets: 4, restSeconds: 120, purpose: "strength", equipment: "barbell", defaultWorkingWeight: 70 },
  { id: "incline-machine-press", name: "Incline Machine Press", target: "3 × 10–12", sets: 3, restSeconds: 105, purpose: "hypertrophy", equipment: "machine", defaultWorkingWeight: 60 },
  { id: "cable-fly", name: "Cable Fly", target: "3 × 12–15", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "cable", defaultWorkingWeight: 20 },
  { id: "machine-shoulder-press", name: "Machine Shoulder Press", target: "3 × 10", sets: 3, restSeconds: 105, purpose: "hypertrophy", equipment: "machine", defaultWorkingWeight: 40 },
  { id: "lateral-raise", name: "Lateral Raise (mechanical drop set)", target: "3 mechanical-drop-set rounds", sets: 3, restSeconds: 60, purpose: "isolation", equipment: "dumbbell", defaultWorkingWeight: 8 },
  { id: "ez-curl", name: "EZ-Bar Curl", target: "3 × 10", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "barbell", defaultWorkingWeight: 25 },
  { id: "hoist-roc-it-leg-extension", name: "Leg Extension", target: "4 × 10–15", sets: 4, restSeconds: 75, purpose: "isolation", equipment: "machine", machineProfile: { manufacturer: "Hoist", model: "ROC-IT", family: "leg extension", stackUnit: "kg" }, defaultWorkingWeight: 40 },
  { id: "hip-thrust", name: "Hip Thrust", target: "3 × 8–12", sets: 3, restSeconds: 120, purpose: "strength", equipment: "machine", defaultWorkingWeight: 60 },
  { id: "lat-pulldown", name: "Lat Pulldown", target: "4 × 8–12", sets: 4, restSeconds: 105, purpose: "hypertrophy", equipment: "machine", defaultWorkingWeight: 55 },
  { id: "rear-delt-fly", name: "Rear-Delt Fly", target: "4 × 12–15", sets: 4, restSeconds: 75, purpose: "isolation", equipment: "machine", defaultWorkingWeight: 30 },
  { id: "shrug", name: "Shrug", target: "3 × 8–12", sets: 3, restSeconds: 105, purpose: "strength", equipment: "dumbbell", defaultWorkingWeight: 30 },
  { id: "incline-db-curl", name: "Incline Dumbbell Curl", target: "3 × 8–12", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "dumbbell", defaultWorkingWeight: 10 },
  { id: "hammer-curl", name: "Hammer Curl", target: "3 × 10–12", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "dumbbell", defaultWorkingWeight: 12 },
  { id: "pull-up-practice", name: "Pull-Up Practice", target: "3 submaximal practice sets", sets: 3, restSeconds: 90, purpose: "strength", equipment: "machine", loadingProfile: "bodyweight_assisted", loadUnit: "assistance", defaultWorkingWeight: 0 },
  { id: "low-to-high-cable-fly", name: "Low-to-High Cable Fly", target: "3 × 12–15", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "cable", defaultWorkingWeight: 15 },
  { id: "lateral-raise-mechanical-drop-set", name: "Lateral Raise Mechanical Drop Set", target: "3 mechanical-drop-set rounds", sets: 3, restSeconds: 60, purpose: "isolation", equipment: "dumbbell", defaultWorkingWeight: 8 },
  { id: "bayesian-cable-curl", name: "Bayesian Cable Curl", target: "3 × 10–15", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "cable", defaultWorkingWeight: 14 },
  { id: "cross-body-single-arm-cable-lat-pulldown", name: "Cross-Body Single-Arm Cable Lat Pulldown", target: "4 × 10–12 per side", sets: 4, restSeconds: 90, purpose: "hypertrophy", equipment: "cable", defaultWorkingWeight: 18 },
  { id: "hoist-roc-it-row", name: "Seated Machine Row", target: "3 × 10–12", sets: 3, restSeconds: 105, purpose: "hypertrophy", equipment: "machine", machineProfile: { manufacturer: "Hoist", model: "ROC-IT", family: "seated row", stackUnit: "kg" }, defaultWorkingWeight: 60 },
  { id: "bulgarian-split-squat", name: "Bulgarian Split Squat", target: "3 × 8–12 per leg", sets: 3, restSeconds: 120, purpose: "strength", equipment: "dumbbell", defaultWorkingWeight: 16 },
  { id: "hip-adductor", name: "Hip Adductor", target: "3 × 12–20", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "machine", defaultWorkingWeight: 50 },
  { id: "hip-abductor", name: "Hip Abductor", target: "3 × 12–20", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "machine", defaultWorkingWeight: 50 },
  { id: "cable-shrug", name: "Cable Shrug", target: "3 × 12–15", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "cable", defaultWorkingWeight: 40 },
];
const libraryExpansion: Exercise[] = [
  { id: "chest-supported-db-row", name: "Chest-Supported DB Row", target: "upper back", sets: 3, restSeconds: 105, purpose: "hypertrophy", equipment: "dumbbell", defaultWorkingWeight: 24 },
  { id: "one-arm-db-row", name: "One-Arm DB Row", target: "lats", sets: 3, restSeconds: 90, purpose: "hypertrophy", equipment: "dumbbell", defaultWorkingWeight: 24 },
  { id: "face-pull", name: "Face Pull", target: "rear delts", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "cable", stackIncrement: 2.5, defaultWorkingWeight: 18 },
  { id: "machine-lateral-raise", name: "Machine Lateral Raise", target: "lateral delts", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "machine", defaultWorkingWeight: 30 },
  { id: "romanian-deadlift", name: "Romanian Deadlift", target: "hamstrings", sets: 3, restSeconds: 150, purpose: "strength", equipment: "barbell", defaultWorkingWeight: 60 },
  { id: "barbell-overhead-press", name: "Barbell Overhead Press", target: "front delts", sets: 3, restSeconds: 135, purpose: "strength", equipment: "barbell", defaultWorkingWeight: 35 },
  { id: "front-squat", name: "Front Squat", target: "quads", sets: 3, restSeconds: 150, purpose: "strength", equipment: "barbell", defaultWorkingWeight: 50 },
  { id: "barbell-hip-thrust", name: "Barbell Hip Thrust", target: "glutes", sets: 3, restSeconds: 120, purpose: "strength", equipment: "barbell", defaultWorkingWeight: 60 },
  { id: "reverse-lunge", name: "Reverse Lunge", target: "quads", sets: 3, restSeconds: 105, purpose: "hypertrophy", equipment: "dumbbell", defaultWorkingWeight: 14 },
  { id: "cable-row", name: "Seated Cable Row", target: "upper back", sets: 3, restSeconds: 105, purpose: "hypertrophy", equipment: "cable", stackIncrement: 2.5, defaultWorkingWeight: 45 },
  { id: "straight-arm-pulldown", name: "Straight-Arm Pulldown", target: "lats", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "cable", stackIncrement: 2.5, defaultWorkingWeight: 25 },
  { id: "pallof-press", name: "Pallof Press", target: "obliques", sets: 2, restSeconds: 60, purpose: "core", equipment: "cable", stackIncrement: 2.5, defaultWorkingWeight: 12 },
  { id: "dead-bug", name: "Dead Bug", target: "abs", sets: 2, restSeconds: 45, purpose: "core", equipment: "machine", defaultWorkingWeight: 0 },
];
const catalogueFromKnowledge: Exercise[] = exerciseLibrary.map(item => ({ id: item.id, name: item.name, target: item.primaryMuscles[0] ?? "full body", sets: item.programmeRole === "primary_compound" ? 4 : item.programmeRole === "isolation" ? 3 : 3, restSeconds: item.programmeRole === "primary_compound" ? 120 : 75, purpose: item.programmeRole === "isolation" ? "isolation" : item.primaryMuscles.includes("abs") || item.primaryMuscles.includes("obliques") ? "core" : "hypertrophy", equipment: item.equipment === "dumbbell" || item.equipment === "barbell" || item.equipment === "cable" ? item.equipment : "machine", loadingProfile: item.equipment === "bodyweight" ? "bodyweight_assisted" : item.equipment.includes("machine") ? "selectorised_compound" : undefined, loadUnit: item.equipment === "dumbbell" ? "per_hand" : item.equipment === "bodyweight" ? "assistance" : item.equipment === "cable" || item.equipment.includes("machine") ? "stack" : "total", defaultWorkingWeight: 0 }));
export const allExercises = (): Exercise[] => Array.from(new Map([...catalogueFromKnowledge, ...mondayExercises, ...additionalExercises, ...libraryExpansion].map(item => [item.id, item])).values());
export const exerciseById = (id: string): Exercise | undefined => allExercises().find(item => item.id === id);
export const exercisesForSession = (exerciseIds: string[], overrides: Record<string, { name?: string; target?: string; sets?: number }> = {}): Exercise[] => {
  const catalog = new Map(allExercises().map(item => [item.id, item]));
  return exerciseIds.map(id => { const exercise = catalog.get(id); if (!exercise) throw new Error(`Unresolved prescribed exercise: ${id}`); return { ...exercise, ...overrides[id] }; });
};
export const parseRange = (target: string) => { const values = target.match(/\d+/g)?.map(Number) ?? [0, 0]; return { low: values[values.length - 2] ?? values[0], high: values[values.length - 1] ?? values[0] }; };
