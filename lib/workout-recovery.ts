import type { Cardio, Workout } from "./types";

export const MONDAY_RECOVERY_DATE = "2026-08-31";
export const MONDAY_PLANNED_SESSION_ID = "mon";

/** Corrections explicitly verified by the owner from the contemporaneous WHOOP record. */
export const verifiedMondayCardio: Cardio = {
  modality: "incline_treadmill",
  duration: 10,
  incline: 9.5,
  speed: 5,
};

export type RecoveryEvidenceSet = NonNullable<Workout["recoveryEvidence"]>[number];
const whoopSet = (exerciseName: string, setOrder: number, weight: number, reps: number, side?: string): RecoveryEvidenceSet & { side?: string } => ({ exerciseName, setOrder, weight, reps, source: "whoop", ...(side ? { side } : {}) });

/** Complete weighted evidence transcribed from the owner-provided WHOOP screenshots. */
export const verifiedMondayEvidenceSets = [
  whoopSet("Incline Dumbbell Bench Press", 1, 14, 12), whoopSet("Incline Dumbbell Bench Press", 2, 22, 8), whoopSet("Incline Dumbbell Bench Press", 3, 24, 8), whoopSet("Incline Dumbbell Bench Press", 4, 30, 10), whoopSet("Incline Dumbbell Bench Press", 5, 30, 10), whoopSet("Incline Dumbbell Bench Press", 6, 30, 8), whoopSet("Incline Dumbbell Bench Press", 7, 30, 6),
  whoopSet("Machine Chest Press", 1, 80, 8), whoopSet("Machine Chest Press", 2, 80, 10), whoopSet("Machine Chest Press", 3, 80, 12), whoopSet("Machine Chest Press", 4, 80, 12),
  whoopSet("Seated Dumbbell Overhead Press", 1, 16, 10), whoopSet("Seated Dumbbell Overhead Press", 2, 20, 8), whoopSet("Seated Dumbbell Overhead Press", 3, 20, 10), whoopSet("Seated Dumbbell Overhead Press", 4, 20, 8),
  whoopSet("Cable Lateral Raise", 1, 5, 8, "left"), whoopSet("Cable Lateral Raise", 2, 9, 15, "left"), whoopSet("Cable Lateral Raise", 3, 9, 15, "left"), whoopSet("Cable Lateral Raise", 4, 9, 10, "left"), whoopSet("Cable Lateral Raise", 5, 9, 10, "left"),
  whoopSet("Cable Lateral Raise", 1, 5, 8, "right"), whoopSet("Cable Lateral Raise", 2, 9, 15, "right"), whoopSet("Cable Lateral Raise", 3, 9, 15, "right"), whoopSet("Cable Lateral Raise", 4, 9, 10, "right"), whoopSet("Cable Lateral Raise", 5, 9, 10, "right"),
  whoopSet("Rope Triceps Pushdown", 1, 41, 8), whoopSet("Rope Triceps Pushdown", 2, 55, 10), whoopSet("Rope Triceps Pushdown", 3, 55, 8), whoopSet("Rope Triceps Pushdown", 4, 50, 8), whoopSet("Rope Triceps Pushdown", 5, 50, 12),
  whoopSet("Overhead Cable Triceps Extension", 1, 23, 8), whoopSet("Overhead Cable Triceps Extension", 2, 32, 12), whoopSet("Overhead Cable Triceps Extension", 3, 32, 12), whoopSet("Overhead Cable Triceps Extension", 4, 32, 9),
  whoopSet("Reverse Crunch Machine", 1, 68, 8), whoopSet("Reverse Crunch Machine", 2, 82, 15), whoopSet("Reverse Crunch Machine", 3, 82, 15), whoopSet("Reverse Crunch Machine", 4, 82, 12),
];

/** Reviewable external-evidence payload. Unknown set values remain absent rather than guessed. */
export const manualMondayReconstruction = {
  plannedSessionId: MONDAY_PLANNED_SESSION_ID,
  scheduledDate: MONDAY_RECOVERY_DATE,
  exercises: [
    { exerciseName: "Incline Dumbbell Bench Press", source: "whoop" as const },
    { exerciseName: "Machine Chest Press", source: "whoop" as const },
    { exerciseName: "Seated Dumbbell Overhead Press", source: "whoop" as const },
    { exerciseName: "Cable Lateral Raise", source: "whoop" as const, note: "Left and right records retained separately." },
    { exerciseName: "Rope Triceps Pushdown", source: "whoop" as const },
    { exerciseName: "Overhead Cable Triceps Extension", source: "whoop" as const, note: "WHOOP label mapped to the prescribed movement." },
    { exerciseName: "Reverse Crunch Machine", source: "whoop" as const, note: "Source label preserved; no Cable Crunch rename." },
  ],
  sets: verifiedMondayEvidenceSets,
  tonnageKg: 14122,
  cardio: verifiedMondayCardio,
  provenance: [
    { source: "whoop" as const, detail: "verified exercise label and 10:00 cardio screenshot" },
    { source: "user_correction" as const, detail: "9.5% incline at 5.0 km/h" },
  ],
};

const tricepsAliases = new Set([
  "tricep extension - standing - rope - pulley machine",
  "triceps extension - standing - rope - pulley machine",
]);

export function mapVerifiedExercise(exerciseId: string, exerciseName: string) {
  if (tricepsAliases.has(exerciseName.trim().toLowerCase())) {
    return { exerciseId: "overhead-cable-triceps-extension", exerciseName: "Overhead Cable Triceps Extension" };
  }
  return { exerciseId, exerciseName };
}

/**
 * Apply only supplied/verified corrections to a genuine local candidate.
 * Set values, timestamps and RIR remain untouched; absent RIR stays absent.
 */
export function reconstructVerifiedMonday(candidate: Workout): Workout {
  return {
    ...candidate,
    origin: "real",
    plannedSessionId: MONDAY_PLANNED_SESSION_ID,
    scheduledDate: MONDAY_RECOVERY_DATE,
    provenance: [...(candidate.provenance ?? []), { source: "local", detail: "owner-reviewed contemporaneous workout record" }, { source: "whoop", detail: "verified cardio screenshot" }, { source: "user_correction", detail: "WHOOP exercise and cardio corrections" }],
    sets: candidate.sets.map(set => ({ ...set, ...mapVerifiedExercise(set.exerciseId, set.exerciseName) })),
    ...(candidate.cardio
      ? { cardio: { ...candidate.cardio, ...verifiedMondayCardio, settings: { ...(candidate.cardio.settings ?? {}), incline: 9.5, speed: 5 } } }
      : { cardio: verifiedMondayCardio }),
  };
}

export function genuineMondayCandidates(workouts: Workout[]) {
  return workouts.filter(workout => {
    if (workout.origin === "test" || (workout.status !== undefined && workout.status !== "completed") || !workout.completedAt) return false;
    const namedMonday = workout.name.toLowerCase().includes("upper push");
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(workout.completedAt));
    const knownMonday = workout.scheduledDate === MONDAY_RECOVERY_DATE || (!workout.scheduledDate && localDate === MONDAY_RECOVERY_DATE);
    return knownMonday && (workout.plannedSessionId === MONDAY_PLANNED_SESSION_ID || namedMonday);
  });
}

export function recoverySummary(workout: Workout) {
  return {
    id: workout.id,
    name: workout.name,
    workingSets: workout.sets.filter(set => set.kind === "working").length,
    totalSets: workout.sets.length,
    cardio: workout.cardio ? { duration: workout.cardio.duration, incline: workout.cardio.incline, speed: workout.cardio.speed } : undefined,
    sources: ["local/contemporaneous record", "owner corrections"],
  };
}
