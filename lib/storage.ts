import type { AppData, Workout } from "./types";
const KEY = "road-to-12-data-v1";
const defaultData = (): AppData => ({ version: 1, workouts: [], bodyMetrics: [], meals: [] });
export function loadData(): AppData { if (typeof window === "undefined") return defaultData(); try { return JSON.parse(localStorage.getItem(KEY) || "null") ?? defaultData(); } catch { return defaultData(); } }
export function saveWorkout(workout: Workout) { const data = loadData(); const index = data.workouts.findIndex(item => item.id === workout.id); if (index === -1) data.workouts.unshift(workout); else data.workouts[index] = workout; localStorage.setItem(KEY, JSON.stringify(data)); }
export function previousSets(exerciseId: string): import("./types").LoggedSet[] { return loadData().workouts.filter(w => w.completedAt).flatMap(w => w.sets).filter(s => s.exerciseId === exerciseId && s.kind === "working").slice(0, 12); }
export function estimate1RM(weight: number, reps: number) { return Math.round(weight * (1 + reps / 30) * 10) / 10; }
