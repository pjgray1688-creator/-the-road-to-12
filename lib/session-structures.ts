import type { LoggedSet } from "./types";
import type { PlannedSession, PlannedSessionStructure, SessionStructureSettings, SessionStructureType } from "./domain";

export const guidedGroupTypes: SessionStructureType[] = ["superset", "triset", "giant_set", "circuit", "complex"];
export const timedStructureTypes: SessionStructureType[] = ["emom", "amrap", "interval"];

export const structureLabels: Record<SessionStructureType, string> = {
  straight: "Straight sets", superset: "Superset", triset: "Triset", giant_set: "Giant set", circuit: "Circuit",
  drop_set: "Drop set", mechanical_drop: "Mechanical drop", rest_pause: "Rest-pause", cluster: "Cluster set",
  emom: "EMOM", amrap: "AMRAP", interval: "Intervals", ladder: "Ladder", pyramid: "Pyramid", complex: "Complex",
};

const positive = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
const settingsOf = (structure: PlannedSessionStructure): SessionStructureSettings => structure.settings ?? {};

export function structureForExercise(session: Pick<PlannedSession, "structures" | "exerciseIds"> | undefined, exerciseId: string | undefined) {
  if (!session || !exerciseId) return undefined;
  return session.structures?.find(item => item.exerciseIds.includes(exerciseId) && item.type !== "straight");
}

export function structureForIndex(session: Pick<PlannedSession, "structures" | "exerciseIds"> | undefined, index: number) {
  return structureForExercise(session, session?.exerciseIds[index]);
}

export function structureRoundCount(structure: PlannedSessionStructure, exerciseSets = 1) {
  const settings = settingsOf(structure);
  return Math.max(1, Math.floor(positive(settings.rounds, structure.type === "circuit" || guidedGroupTypes.includes(structure.type) ? exerciseSets : 1)));
}

export function workingCount(sets: LoggedSet[], exerciseId: string) { return sets.filter(set => set.exerciseId === exerciseId && set.kind === "working").length; }

export type GuidedProgress = { label: string; round?: number; totalRounds?: number; memberIndex?: number; memberCount?: number; stage?: string; nextExerciseId?: string; restSeconds?: number };

export function guidedProgress(structure: PlannedSessionStructure, currentExerciseId: string, sets: LoggedSet[], exerciseSets = 1): GuidedProgress {
  const settings = settingsOf(structure);
  const memberIndex = Math.max(0, structure.exerciseIds.indexOf(currentExerciseId));
  const memberCount = structure.exerciseIds.length;
  const rounds = structureRoundCount(structure, exerciseSets);
  const count = workingCount(sets, currentExerciseId);
  const result: GuidedProgress = { label: structureLabels[structure.type], memberIndex, memberCount, round: Math.min(rounds, Math.max(1, count + 1)), totalRounds: rounds };
  if (structure.type === "drop_set" || structure.type === "mechanical_drop") result.stage = `${structure.type === "mechanical_drop" ? "Mechanical drop" : "Drop"} ${Math.min(positive(settings.drops, 1), Math.max(1, count))} of ${Math.max(1, Math.floor(positive(settings.drops, 1)))}`;
  if (structure.type === "rest_pause") result.stage = count ? `Mini-set ${count}` : "Initial effort";
  if (structure.type === "cluster") result.stage = `Cluster ${Math.min(Math.max(1, count), Math.max(1, Math.floor(positive(settings.clustersPerSet, 1))))} of ${Math.max(1, Math.floor(positive(settings.clustersPerSet, 1)))}`;
  if (structure.type === "ladder" || structure.type === "pyramid") result.stage = settings.steps ? `Step ${Math.min(Math.max(1, count), settings.steps.split(",").length)}` : `Step ${Math.max(1, count)}`;
  const next = structure.exerciseIds.find((id, index) => index > memberIndex && workingCount(sets, id) < rounds) ?? structure.exerciseIds.find(id => workingCount(sets, id) < rounds);
  result.nextExerciseId = next && next !== currentExerciseId ? next : undefined;
  if (result.nextExerciseId && memberIndex === memberCount - 1) result.restSeconds = positive(settings.restBetweenRoundsSeconds, 0);
  else if (result.nextExerciseId) result.restSeconds = positive(settings.restBetweenExercisesSeconds, 0);
  return result;
}

export function nextGuidedIndex(session: Pick<PlannedSession, "structures" | "exerciseIds"> | undefined, currentIndex: number, sets: LoggedSet[], exerciseSets = 1) {
  const structure = structureForIndex(session, currentIndex);
  if (!structure || !guidedGroupTypes.includes(structure.type)) return { index: currentIndex + 1, completed: false, restSeconds: 0 };
  const progress = guidedProgress(structure, session!.exerciseIds[currentIndex], sets, exerciseSets);
  if (progress.nextExerciseId) return { index: session!.exerciseIds.indexOf(progress.nextExerciseId), completed: false, restSeconds: progress.restSeconds ?? 0 };
  const groupIndexes = structure.exerciseIds.map(id => session!.exerciseIds.indexOf(id)).filter(index => index >= 0);
  const after = Math.max(...groupIndexes, currentIndex) + 1;
  return { index: after, completed: true, restSeconds: 0 };
}

export function timedStructureDurationSeconds(structure: PlannedSessionStructure) {
  const settings = settingsOf(structure);
  if (structure.type === "emom" || structure.type === "amrap") return Math.max(1, Math.floor(positive(settings.durationMinutes, positive(settings.rounds, 1) ) * 60));
  if (structure.type === "interval") return Math.max(1, Math.floor(positive(settings.rounds, 1) * (positive(settings.workSeconds, 30) + positive(settings.restSeconds, 30))));
  return 0;
}

export function timedStructureState(structure: PlannedSessionStructure, elapsedMs: number) {
  const elapsed = Math.max(0, Math.floor(elapsedMs / 1000));
  const total = timedStructureDurationSeconds(structure);
  const remaining = Math.max(0, total - elapsed);
  const settings = settingsOf(structure);
  if (structure.type === "emom") { const minute = Math.min(Math.floor(elapsed / 60), Math.max(0, Math.ceil(total / 60) - 1)); return { total, elapsed, remaining, phase: "work" as const, round: minute + 1, stationIndex: structure.exerciseIds.length ? minute % structure.exerciseIds.length : 0 }; }
  if (structure.type === "amrap") return { total, elapsed, remaining, phase: "work" as const, round: undefined, stationIndex: structure.exerciseIds.length ? Math.floor(elapsed / 30) % structure.exerciseIds.length : 0 };
  const work = Math.max(1, Math.floor(positive(settings.workSeconds, 30))); const rest = Math.max(0, Math.floor(positive(settings.restSeconds, 30))); const cycle = work + rest; const position = elapsed % cycle; const round = Math.min(Math.max(1, Math.floor(elapsed / cycle) + 1), Math.max(1, Math.floor(positive(settings.rounds, 1)))); return { total, elapsed, remaining, phase: position < work ? "work" as const : "rest" as const, phaseRemaining: position < work ? work - position : cycle - position, round, stationIndex: structure.exerciseIds.length ? (round - 1) % structure.exerciseIds.length : 0 };
}
