import { estimate1RM } from "./storage";
import type { LoggedSet, Workout } from "./types";

export function completedWorkouts(workouts: Workout[]) {
  const visible = workouts.filter(workout => (workout.status === "completed" || workout.completedAt) && workout.outcome !== "discarded" && workout.origin !== "test" && workout.origin !== "historical" && (workout.sets.length > 0 || workout.cardio));
  const selected = new Map<string, Workout>();
  for (const workout of visible) {
    const key = workout.plannedSessionId && workout.scheduledDate ? `${workout.plannedSessionId}:${workout.scheduledDate}` : `legacy:${workout.id}`;
    const current = selected.get(key);
    if (!current || workout.sets.filter(set => set.kind === "working").length > current.sets.filter(set => set.kind === "working").length || (workout.sets.length > current.sets.length && !workout.sets.some(set => set.kind === "working") && !current.sets.some(set => set.kind === "working"))) selected.set(key, workout);
  }
  return [...selected.values()].sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt));
}
/** Performed sessions include deliberately ended partial workouts, but never discarded/empty records. */
export function performedWorkouts(workouts: Workout[]) {
  return workouts.filter(workout => (workout.status === "completed" || workout.status === "partial" || workout.completedAt) && workout.outcome !== "discarded" && workout.origin !== "test" && workout.origin !== "historical" && (workout.sets.length > 0 || workout.cardio));
}
export function workingSets(workout: Workout): LoggedSet[] { return workout.sets.filter(set => set.kind === "working"); }
/** Canonical progression evidence: only working sets from completed, non-test sessions. */
export function progressionHistoryForExercise(exerciseId: string, workouts: Workout[]) {
  return completedWorkouts(workouts)
    .flatMap(workout => workingSets(workout).filter(set => set.exerciseId === exerciseId).map(set => ({ ...set, workoutId: workout.id, completedAt: workout.completedAt ?? workout.startedAt })));
}
export type HistoryExerciseGroup = { exerciseId: string; exerciseName: string; sets: LoggedSet[]; unilateral: boolean };
const unilateralName = /(lateral raise|single[- ]arm|single[- ]leg|bulgarian split|unilateral)/i;
function sideOf(name: string) { const match = name.match(/(?:\s|[-—])(left|right|l|r)$/i); return match?.[1]?.toLowerCase().startsWith("l") ? "left" : match?.[1] ? "right" : undefined; }
export function historySideLabel(name: string) { return sideOf(name) ? (sideOf(name) === "left" ? "Left" : "Right") : "Each side"; }
export function formatLogicalHistorySet(sets: LoggedSet[]) {
  if (sets.length < 2) { const set = sets[0]; return set ? `${set.weight} kg × ${set.reps}${set.rir === undefined ? "" : ` · ${set.rir} RIR`}` : ""; }
  const [left, right] = sets;
  if (left.weight === right.weight && left.reps === right.reps && left.rir === right.rir) return `${left.weight} kg × ${left.reps} / side${left.rir === undefined ? "" : ` · ${left.rir} RIR`}`;
  return `L ${left.weight} kg × ${left.reps}${left.rir === undefined ? "" : ` · ${left.rir} RIR`} · R ${right.weight} kg × ${right.reps}${right.rir === undefined ? "" : ` · ${right.rir} RIR`}`;
}
function baseExerciseName(name: string) { return name.replace(/\s*(?:[-—]\s*)?(?:left|right|l|r)$/i, "").trim(); }
export function historyExerciseGroups(workout: Workout): HistoryExerciseGroup[] {
  const source = workingSets(workout);
  const groups = new Map<string, LoggedSet[]>();
  for (const set of source) { const base = baseExerciseName(set.exerciseName).toLowerCase(); const key = unilateralName.test(base) ? `unilateral:${base}` : `${set.exerciseId}:${base}`; groups.set(key, [...(groups.get(key) ?? []), set]); }
  return [...groups.values()].map(sets => {
    const exerciseName = baseExerciseName(sets[0].exerciseName);
    const unilateral = unilateralName.test(exerciseName) || new Set(sets.map(set => sideOf(set.exerciseName)).filter(Boolean)).size > 1;
    if (!unilateral) return { exerciseId: sets[0].exerciseId, exerciseName, sets, unilateral: false };
    const left = sets.filter(set => sideOf(set.exerciseName) === "left"); const right = sets.filter(set => sideOf(set.exerciseName) === "right");
    if (!left.length || !right.length) return { exerciseId: sets[0].exerciseId, exerciseName, sets, unilateral: true };
    const paired = left.flatMap((item, index) => [item, ...(right[index] ? [right[index]] : [])]);
    return { exerciseId: sets[0].exerciseId, exerciseName, sets: paired, unilateral: true };
  });
}
export type PersonalBest = { exerciseId: string; exerciseName: string; weight: number; reps: number; estimated1RM?: number; date: string };
export type PersonalBestCategory = "free_weight_compound" | "power" | "machine_compound";
const primaryPbIds = new Map<string, PersonalBestCategory>([
  ["flat-bench", "free_weight_compound"], ["barbell-row", "free_weight_compound"], ["rdl", "free_weight_compound"], ["trap-bar-deadlift", "free_weight_compound"],
  ["hack-squat", "machine_compound"], ["leg-press", "machine_compound"], ["machine-chest-press", "machine_compound"], ["incline-machine-press", "machine_compound"],
  ["snatch", "power"], ["power-snatch", "power"], ["clean", "power"], ["power-clean", "power"], ["clean-and-jerk", "power"], ["hang-clean", "power"]
]);
export function personalBestCategory(exerciseId: string, exerciseName: string): PersonalBestCategory | undefined {
  const direct = primaryPbIds.get(exerciseId); if (direct) return direct;
  const name = exerciseName.toLowerCase();
  if (/(snatch|clean|jerk)/.test(name)) return "power";
  if (/(bench press|overhead press|military press|back squat|front squat|deadlift|romanian deadlift|barbell row|pendlay row)/.test(name)) return "free_weight_compound";
  if (/(hack squat|leg press|machine chest press|machine shoulder press)/.test(name)) return "machine_compound";
  return undefined;
}
export function personalBests(workouts: Workout[]): PersonalBest[] {
  const best = new Map<string, PersonalBest>();
  for (const workout of completedWorkouts(workouts)) for (const set of workingSets(workout)) {
    if (set.weight <= 0 || !personalBestCategory(set.exerciseId, set.exerciseName)) continue;
    const candidate = { exerciseId: set.exerciseId, exerciseName: set.exerciseName, weight: set.weight, reps: set.reps, estimated1RM: set.reps <= 15 ? estimate1RM(set.weight, set.reps) : undefined, date: (workout.completedAt ?? workout.startedAt).slice(0, 10) };
    const current = best.get(set.exerciseId); if (!current || candidate.weight > current.weight || (candidate.weight === current.weight && candidate.reps > current.reps)) best.set(set.exerciseId, candidate);
  }
  const rank: Record<PersonalBestCategory, number> = { free_weight_compound: 0, power: 1, machine_compound: 2 };
  return [...best.values()].sort((a, b) => rank[personalBestCategory(a.exerciseId, a.exerciseName)!] - rank[personalBestCategory(b.exerciseId, b.exerciseName)!] || a.exerciseName.localeCompare(b.exerciseName));
}
