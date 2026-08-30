import type { Exercise } from "./types";

export const mondayExercises: Exercise[] = [
  { id: "incline-db-press", name: "Incline DB Press", target: "4 × 8–10", sets: 4, restSeconds: 150, purpose: "strength" },
  { id: "machine-chest-press", name: "Machine Chest Press", target: "3 × 10–12", sets: 3, restSeconds: 120, purpose: "hypertrophy" },
  { id: "seated-db-shoulder-press", name: "Seated DB Shoulder Press", target: "3 × 8–10", sets: 3, restSeconds: 150, purpose: "strength" },
  { id: "cable-lateral-raise", name: "Cable Lateral Raise", target: "4 × 12–15", sets: 4, restSeconds: 75, purpose: "isolation" },
  { id: "rope-triceps-pushdown", name: "Cable/Rope Triceps Pushdown", target: "4 × 10–15", sets: 4, restSeconds: 75, purpose: "isolation" },
  { id: "overhead-cable-triceps-extension", name: "Overhead Cable Triceps Extension", target: "3 × 12", sets: 3, restSeconds: 75, purpose: "isolation" },
  { id: "cable-crunch", name: "Cable Crunch", target: "3 × 12–15", sets: 3, restSeconds: 60, purpose: "core" },
];
export const parseRange = (target: string) => { const values = target.match(/\d+/g)?.map(Number) ?? [0, 0]; return { low: values[values.length - 2] ?? values[0], high: values[values.length - 1] ?? values[0] }; };
