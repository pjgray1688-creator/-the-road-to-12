import { sessionStructureTypes, type PlannedExerciseOverride, type PlannedSession, type PlannedSessionStructure, type SessionStructureSettings, type SessionStructureType, type SessionStatus } from "./domain";
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

export const sessionStructureLabels: Record<SessionStructureType, string> = {
  straight: "Straight sets", superset: "Superset", triset: "Triset", giant_set: "Giant set", circuit: "Circuit", drop_set: "Drop set", mechanical_drop: "Mechanical drop", rest_pause: "Rest-pause", cluster: "Cluster set", emom: "EMOM", amrap: "AMRAP", interval: "Intervals", ladder: "Ladder", pyramid: "Pyramid", complex: "Complex",
};

const positiveFields = new Set(["rounds", "drops", "durationMinutes", "workSeconds", "restSeconds", "restBetweenExercisesSeconds", "restBetweenRoundsSeconds", "shortRestSeconds", "repeats", "repsPerCluster", "clustersPerSet", "intraClusterRestSeconds", "sets"]);
const structureMinimums: Partial<Record<SessionStructureType, number>> = { superset: 2, triset: 3, giant_set: 4, circuit: 2, emom: 1, amrap: 1, interval: 1, ladder: 1, pyramid: 1, complex: 2 };

export function validateSessionStructures(session: PlannedSession): string[] {
  const issues: string[] = [];
  if (!session || typeof session !== "object" || !Array.isArray(session.exerciseIds)) return ["Session exercises must be an array"];
  const exerciseIds = new Set(session.exerciseIds);
  const groups = session.structures ?? [];
  const claimed = new Set<string>();
  for (const [index, structure] of groups.entries()) {
    if (!structure || typeof structure !== "object") { issues.push(`structure-${index}: must be an object`); continue; }
    if (!structure.id || typeof structure.id !== "string" || structure.id.length > 160) issues.push(`structure-${index}: id is invalid`);
    if (!sessionStructureTypes.includes(structure.type)) issues.push(`structure-${index}: type is invalid`);
    if (!Array.isArray(structure.exerciseIds) || structure.exerciseIds.length === 0) { issues.push(`structure-${index}: exercises are required`); continue; }
    const minimum = structureMinimums[structure.type];
    if (minimum && structure.exerciseIds.length < minimum) issues.push(`${structure.type}: needs at least ${minimum} exercises`);
    const local = new Set<string>();
    for (const exerciseId of structure.exerciseIds) {
      if (!exerciseIds.has(exerciseId)) issues.push(`${structure.type}: references an exercise outside the session`);
      if (local.has(exerciseId)) issues.push(`${structure.type}: contains a duplicate exercise`);
      local.add(exerciseId);
      if (claimed.has(exerciseId)) issues.push(`exercise ${exerciseId}: belongs to more than one structure`);
      claimed.add(exerciseId);
    }
    const settings = structure.settings;
    if (settings && typeof settings !== "object") issues.push(`${structure.type}: settings must be an object`);
    if (settings) {
      for (const [key, value] of Object.entries(settings)) {
        if (positiveFields.has(key) && (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 10000)) issues.push(`${structure.type}: ${key} must be a positive bounded number`);
        if (["loadReduction", "repTarget", "steps", "notes"].includes(key) && (typeof value !== "string" || value.length > 2000)) issues.push(`${structure.type}: ${key} must be a bounded string`);
      }
      if (["ladder", "pyramid"].includes(structure.type) && !settings.steps?.trim()) issues.push(`${structure.type}: steps are required`);
      if (["emom", "amrap", "interval"].includes(structure.type) && !settings.durationMinutes && !settings.rounds) issues.push(`${structure.type}: duration or rounds are required`);
    }
  }
  return issues;
}

export function validateBuilderProgramme(programme: BuilderProgramme): string[] {
  if (!programme || typeof programme !== "object") return ["Programme must be an object"];
  if (!Array.isArray(programme.week)) return ["Programme sessions must be an array"];
  return programme.week.flatMap(session => validateSessionStructures(session));
}

export function structureForExercise(session: PlannedSession, exerciseId: string) {
  return (session.structures ?? []).find(structure => structure.exerciseIds.includes(exerciseId));
}

export function createStructure(session: PlannedSession, type: SessionStructureType, exerciseIds: string[], settings: SessionStructureSettings = {}): PlannedSession {
  const ids = exerciseIds.filter((id, index) => session.exerciseIds.includes(id) && exerciseIds.indexOf(id) === index);
  if (!ids.length) return session;
  const structures = [...(session.structures ?? []).filter(structure => !ids.some(id => structure.exerciseIds.includes(id)))];
  return { ...session, structures: [...structures, { id: `structure-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, exerciseIds: ids, settings }] };
}

export function updateStructure(session: PlannedSession, structureId: string, patch: Partial<PlannedSessionStructure>): PlannedSession {
  return { ...session, structures: (session.structures ?? []).map(structure => structure.id === structureId ? { ...structure, ...patch } : structure) };
}

export function updateStructureSettings(session: PlannedSession, structureId: string, patch: SessionStructureSettings): PlannedSession {
  return { ...session, structures: (session.structures ?? []).map(structure => structure.id === structureId ? { ...structure, settings: { ...structure.settings, ...patch } } : structure) };
}

export function removeStructure(session: PlannedSession, structureId: string): PlannedSession {
  return { ...session, structures: (session.structures ?? []).filter(structure => structure.id !== structureId) };
}

export function reorderStructureExercise(session: PlannedSession, structureId: string, index: number, direction: -1 | 1): PlannedSession {
  return updateStructure(session, structureId, { exerciseIds: moveIds((session.structures ?? []).find(structure => structure.id === structureId)?.exerciseIds ?? [], index, direction) });
}

function moveIds(ids: string[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return ids;
  const next = [...ids]; [next[index], next[target]] = [next[target], next[index]]; return next;
}

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
  return { ...session, exerciseIds: session.exerciseIds.filter(id => id !== exerciseId), exerciseOverrides: overrides, structures: (session.structures ?? []).map(structure => ({ ...structure, exerciseIds: structure.exerciseIds.filter(id => id !== exerciseId) })).filter(structure => structure.exerciseIds.length > 0) };
}

export function moveExercise(session: PlannedSession, index: number, direction: -1 | 1): PlannedSession {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= session.exerciseIds.length) return session;
  const exerciseIds = [...session.exerciseIds];
  [exerciseIds[index], exerciseIds[target]] = [exerciseIds[target], exerciseIds[index]];
  const positions = new Map(exerciseIds.map((id, position) => [id, position]));
  return { ...session, exerciseIds, structures: (session.structures ?? []).map(structure => ({ ...structure, exerciseIds: [...structure.exerciseIds].sort((a, b) => (positions.get(a) ?? 0) - (positions.get(b) ?? 0)) })) };
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
