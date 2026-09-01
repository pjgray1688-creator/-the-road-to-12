import { estimate1RM } from "./storage";
import type { LoggedSet, Workout } from "./types";

export function completedWorkouts(workouts: Workout[]) { return workouts.filter(workout => workout.status === "completed" || workout.completedAt).filter(workout => workout.origin !== "test").sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt)); }
export function workingSets(workout: Workout): LoggedSet[] { return workout.sets.filter(set => set.kind === "working"); }
export type PersonalBest = { exerciseId: string; exerciseName: string; weight: number; reps: number; estimated1RM?: number; date: string };
export function personalBests(workouts: Workout[]): PersonalBest[] {
  const best = new Map<string, PersonalBest>();
  for (const workout of completedWorkouts(workouts)) for (const set of workingSets(workout)) {
    if (set.weight <= 0) continue;
    const candidate = { exerciseId: set.exerciseId, exerciseName: set.exerciseName, weight: set.weight, reps: set.reps, estimated1RM: set.reps <= 15 ? estimate1RM(set.weight, set.reps) : undefined, date: (workout.completedAt ?? workout.startedAt).slice(0, 10) };
    const current = best.get(set.exerciseId); if (!current || candidate.weight > current.weight || (candidate.weight === current.weight && candidate.reps > current.reps)) best.set(set.exerciseId, candidate);
  }
  return [...best.values()].sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}
