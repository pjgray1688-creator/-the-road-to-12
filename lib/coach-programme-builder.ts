import type { PlannedExerciseOverride, PlannedSession, SessionStatus } from "./domain";
import { exerciseKnowledge, filterExercises, searchExercises, type ExerciseFilters, type ExerciseKnowledge, type PrescriptionMetric } from "./exercise-library";
import { exerciseById } from "./workout";

export type BuilderProgramme = {
  id: string;
  name?: string;
  rationale?: string;
  profile?: unknown;
  block?: unknown;
  week: PlannedSession[];
  [key: string]: unknown;
};

export const builderMetricLabels: Record<PrescriptionMetric, string> = {
  reps: "Reps",
  load: "Load target",
  time: "Time",
  distance: "Distance",
  calories: "Calories",
  pace: "Pace",
  heartRate: "Heart rate",
  heartRateZone: "Heart-rate zone",
  RPE: "RPE",
  RIR: "RIR",
  rounds: "Rounds",
  cadence: "Cadence",
  incline: "Incline",
  speed: "Speed",
};

export function builderSearch(query: string, filters: ExerciseFilters = {}) {
  return searchExercises(query, filters).slice(0, 24);
}

export function prescriptionMetrics(exerciseId: string): PrescriptionMetric[] {
  return exerciseKnowledge(exerciseId)?.supportedPrescriptionMetrics ?? ["reps", "load", "RIR"];
}

export function builderKnowledge(exerciseId: string): ExerciseKnowledge | undefined {
  return exerciseKnowledge(exerciseId);
}

export function newProgrammeSession(index: number): PlannedSession {
  return { id: `coach-session-${Date.now()}-${index}`, day: index + 1, name: `Session ${String.fromCharCode(65 + (index % 26))}`, status: "planned" as SessionStatus, exerciseIds: [] };
}

export function addExercise(session: PlannedSession, exerciseId: string): PlannedSession {
  const exercise = exerciseById(exerciseId);
  if (!exercise || session.exerciseIds.includes(exercise.id)) return session;
  return {
    ...session,
    exerciseIds: [...session.exerciseIds, exercise.id],
    exerciseOverrides: {
      ...session.exerciseOverrides,
      [exercise.id]: { sets: exercise.sets, target: exercise.target, restSeconds: exercise.restSeconds },
    },
  };
}

export function removeExercise(session: PlannedSession, exerciseId: string): PlannedSession {
  const overrides = { ...session.exerciseOverrides };
  delete overrides[exerciseId];
  return { ...session, exerciseIds: session.exerciseIds.filter(id => id !== exerciseId), exerciseOverrides: overrides };
}

export function moveExercise(session: PlannedSession, index: number, direction: -1 | 1): PlannedSession {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= session.exerciseIds.length) return session;
  const exerciseIds = [...session.exerciseIds];
  [exerciseIds[index], exerciseIds[target]] = [exerciseIds[target], exerciseIds[index]];
  return { ...session, exerciseIds };
}

export function updateOverride(session: PlannedSession, exerciseId: string, patch: PlannedExerciseOverride): PlannedSession {
  return { ...session, exerciseOverrides: { ...session.exerciseOverrides, [exerciseId]: { ...session.exerciseOverrides?.[exerciseId], ...patch } } };
}

export function moveSession(week: PlannedSession[], index: number, direction: -1 | 1): PlannedSession[] {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= week.length) return week;
  const next = [...week];
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((session, position) => ({ ...session, day: position + 1 }));
}

export function filterOptions() {
  const all = filterExercises();
  return {
    equipment: [...new Set(all.flatMap(item => item.equipmentRequired))].sort(),
    muscle: [...new Set(all.flatMap(item => item.primaryMuscles))].sort(),
    movementPattern: [...new Set(all.map(item => item.movementPattern))].sort(),
    trainingStyle: [...new Set(all.flatMap(item => item.trainingStyles))].sort(),
  };
}
