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

export type ProposedSetClassification = { exerciseName: string; side?: string; setOrder: number; proposedKind: "warmup" | "ramp" | "working" | "unknown"; reason: string; confidence: "high" | "medium" | "low"; performanceHistoryEligible: boolean };

/** Structural proposal only; this never mutates evidence or invents RIR. */
export function proposeMondaySetClassifications(): ProposedSetClassification[] {
  const workingCounts: Record<string, number> = { "Incline Dumbbell Bench Press": 4, "Machine Chest Press": 3, "Seated Dumbbell Overhead Press": 3, "Cable Lateral Raise": 4, "Rope Triceps Pushdown": 4, "Overhead Cable Triceps Extension": 3 };
  const grouped = new Map<string, typeof verifiedMondayEvidenceSets>();
  for (const set of verifiedMondayEvidenceSets) grouped.set(`${set.exerciseName}:${set.side ?? "both"}`, [...(grouped.get(`${set.exerciseName}:${set.side ?? "both"}`) ?? []), set]);
  return verifiedMondayEvidenceSets.map(set => {
    const group = grouped.get(`${set.exerciseName}:${set.side ?? "both"}`) ?? [];
    const workingCount = workingCounts[set.exerciseName];
    if (!workingCount || group.length < workingCount + 1) {
      if (set.exerciseName === "Reverse Crunch Machine" && group.length === 4) return { ...set, proposedKind: "unknown", reason: "Source evidence preserves this substituted movement, but its working-set role is not promoted without independent confirmation.", confidence: "low", performanceHistoryEligible: false };
      return { ...set, proposedKind: "unknown", reason: "The source exercise/count does not unambiguously match a prescribed movement.", confidence: "low", performanceHistoryEligible: false };
    }
    const workingStart = group.length - workingCount;
    if (set.setOrder > workingStart) return { ...set, proposedKind: "working", reason: `The final ${workingCount} ordered sets match the programme's prescribed working-set count.`, confidence: "high", performanceHistoryEligible: true };
    return { ...set, proposedKind: set.setOrder === 1 ? "ramp" : "ramp", reason: "One preparation set precedes the exact prescribed working-set count; preparation subtype is not independently proven.", confidence: "medium", performanceHistoryEligible: false };
  });
}

const exerciseIds: Record<string, string> = {
  "Incline Dumbbell Bench Press": "incline-db-press", "Machine Chest Press": "machine-chest-press", "Seated Dumbbell Overhead Press": "seated-db-shoulder-press", "Cable Lateral Raise": "cable-lateral-raise", "Rope Triceps Pushdown": "rope-triceps-pushdown", "Overhead Cable Triceps Extension": "overhead-cable-triceps-extension", "Reverse Crunch Machine": "reverse-crunch-machine",
};

/** Build the owner-approved evidence promotion without assigning performance meaning to Reverse Crunch. */
export function promotableMondayWorkout(now = new Date().toISOString()): Workout {
  const classifications = proposeMondaySetClassifications();
  const classificationByKey = new Map(classifications.map(item => [`${item.exerciseName}:${item.side ?? "both"}:${item.setOrder}`, item]));
  const sets = verifiedMondayEvidenceSets.filter(set => set.exerciseName !== "Reverse Crunch Machine").map((set, index) => {
    const classification = classificationByKey.get(`${set.exerciseName}:${set.side ?? "both"}:${set.setOrder}`)!;
    const kind: "working" | "ramp" = classification.proposedKind === "working" ? "working" : "ramp";
    return { id: `recovered-mon-${index + 1}`, exerciseId: exerciseIds[set.exerciseName], exerciseName: set.exerciseName, weight: set.weight!, reps: set.reps!, kind, createdAt: now, ...(set.side ? { side: set.side } : {}) };
  });
  return { id: "recovered-monday-2026-08-31", name: "Monday — Upper Push + Core + Conditioning", plannedSessionId: MONDAY_PLANNED_SESSION_ID, scheduledDate: MONDAY_RECOVERY_DATE, status: "completed", startedAt: now, completedAt: now, sets, substitutions: { "cable-crunch": "Reverse Crunch Machine" }, cardio: verifiedMondayCardio, notes: ["Owner-approved WHOOP reconstruction; workout timestamp unavailable."], origin: "real", provenance: [{ source: "whoop", detail: "verified weighted exercise screenshots and cardio entry" }, { source: "user_correction", detail: "Incline treadmill 9.5% at 5.0 km/h; Reverse Crunch Machine name preserved" }], recoveryEvidence: verifiedMondayEvidenceSets.filter(set => set.exerciseName === "Reverse Crunch Machine") };
}

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
  classifications: proposeMondaySetClassifications(),
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
