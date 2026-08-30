import type { AppData, Workout } from "./types";
const KEY = "road-to-12-data-v1";
const defaultData = (): AppData => ({ version: 2, workouts: [], bodyMetrics: [], meals: [] });
export function loadData(): AppData { if (typeof window === "undefined") return defaultData(); try { const data = JSON.parse(localStorage.getItem(KEY) || "null") ?? defaultData(); return { ...defaultData(), ...data, version: 2, workouts: data.workouts ?? [], bodyMetrics: data.bodyMetrics ?? [], meals: data.meals ?? [] }; } catch { return defaultData(); } }
export function saveData(data: AppData) { localStorage.setItem(KEY, JSON.stringify(data)); }
export function saveWorkout(workout: Workout) { const data = loadData(); const record = { ...workout, origin: workout.origin ?? "real" }; const index = data.workouts.findIndex(item => item.id === workout.id); if (index === -1) data.workouts.unshift(record); else data.workouts[index] = record; saveData(data); }
export function resetTestData() { const data = loadData(); saveData({ ...data, workouts: data.workouts.filter(item => item.origin !== "test"), bodyMetrics: data.bodyMetrics.filter(item => item.origin !== "test"), meals: data.meals.filter(item => item.origin !== "test") }); localStorage.removeItem("road-to-12-active-test"); }
export function previousSets(exerciseId: string): import("./types").LoggedSet[] { return loadData().workouts.filter(w => w.completedAt).flatMap(w => w.sets).filter(s => s.exerciseId === exerciseId && s.kind === "working").slice(0, 12); }
export function estimate1RM(weight: number, reps: number) { return Math.round(weight * (1 + reps / 30) * 10) / 10; }
