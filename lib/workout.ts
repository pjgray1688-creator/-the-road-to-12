import type { Exercise } from "./types";

export const mondayExercises: Exercise[] = [
  { id: "incline-db-press", name: "Incline DB Press", target: "4 × 8–10", sets: 4, restSeconds: 150, purpose: "strength", equipment: "dumbbell", defaultWorkingWeight: 20 },
  { id: "machine-chest-press", name: "Machine Chest Press", target: "3 × 10–12", sets: 3, restSeconds: 120, purpose: "hypertrophy", equipment: "machine", stackIncrement: 5, defaultWorkingWeight: 40 },
  { id: "seated-db-shoulder-press", name: "Seated DB Shoulder Press", target: "3 × 8–10", sets: 3, restSeconds: 150, purpose: "strength", equipment: "dumbbell", defaultWorkingWeight: 12 },
  { id: "cable-lateral-raise", name: "Cable Lateral Raise", target: "4 × 12–15", sets: 4, restSeconds: 75, purpose: "isolation", equipment: "cable", stackIncrement: 2.5, defaultWorkingWeight: 5 },
  { id: "rope-triceps-pushdown", name: "Cable/Rope Triceps Pushdown", target: "4 × 10–15", sets: 4, restSeconds: 75, purpose: "isolation", equipment: "cable", stackIncrement: 2.5, defaultWorkingWeight: 25 },
  { id: "overhead-cable-triceps-extension", name: "Overhead Cable Triceps Extension", target: "3 × 12", sets: 3, restSeconds: 75, purpose: "isolation", equipment: "cable", stackIncrement: 2.5, defaultWorkingWeight: 20 },
  { id: "cable-crunch", name: "Cable Crunch", target: "3 × 12–15", sets: 3, restSeconds: 60, purpose: "core", equipment: "cable", stackIncrement: 2.5, defaultWorkingWeight: 30 },
];
export const parseRange = (target: string) => { const values = target.match(/\d+/g)?.map(Number) ?? [0, 0]; return { low: values[values.length - 2] ?? values[0], high: values[values.length - 1] ?? values[0] }; };
