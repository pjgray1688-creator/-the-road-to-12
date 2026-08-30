import type { HistoricalRecord } from "./domain";
export const genuineHistoricalTraining: HistoricalRecord[] = [
  { id: "hist-machine-shoulder-49x12", origin: "historical", exerciseId: "machine-shoulder-press", exerciseName: "Machine Shoulder Press", weight: 49, reps: 12, rir: "~1–2", confidence: "high" },
  { id: "hist-vbar-55x13", origin: "historical", exerciseId: "rope-triceps-pushdown", exerciseName: "V-bar Triceps Pushdown", weight: 55, reps: 13, rir: "~1–2", confidence: "high" },
  { id: "hist-overhead-27x15", origin: "historical", exerciseId: "overhead-cable-triceps-extension", exerciseName: "Overhead Cable Triceps Extension", weight: 27, reps: 15, rir: "~2–3", confidence: "high" },
  { id: "hist-lat-pulldown-65x10", origin: "historical", exerciseId: "lat-pulldown", exerciseName: "Lat Pulldown", weight: 65, reps: 10, confidence: "high" },
  { id: "hist-leg-press-300x10", origin: "historical", exerciseId: "leg-press", exerciseName: "Leg Press", weight: 300, reps: 10, confidence: "contextual", note: "Approximate established historical top work" },
  { id: "hist-incline-db-40", origin: "historical", exerciseId: "incline-db-press", exerciseName: "Incline DB Press", weight: 40, reps: 8, confidence: "contextual", note: "Working sets previously in 34–40kg range" }
];
