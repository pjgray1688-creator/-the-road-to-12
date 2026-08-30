import type { PlannedSession, RecoverySnapshot, SessionStatus } from "./domain";

export type ReadinessLevel = "READY" | "TRAIN WITH CAUTION" | "RECOVERY PRIORITY";
export type ReadinessInput = { recovery?: RecoverySnapshot; fatigue?: boolean; pain?: boolean; recentStrain?: number };
export type SessionAdaptation = { level: ReadinessLevel; action: "proceed" | "reduce_demand" | "rest"; message: string; reduceSetsBy?: number; cardioMinutes?: number };
export type Exposure = { date: string; weight: number; reps: number; rir?: number; comparable: boolean };
export type StallProposal = { proposed: boolean; message?: string; replacement?: string; temporarySessions?: number };

export function assessReadiness(input: ReadinessInput): { level: ReadinessLevel; message: string } {
  if (input.recovery?.userReported && ((input.recovery.fatigue ?? 0) >= 4 || (input.recovery.soreness ?? 0) >= 5)) return { level: "RECOVERY PRIORITY", message: "Your reported fatigue is high. Reduce demand and protect recovery." };
  if (input.recovery?.userReported && ((input.recovery.energy ?? 5) <= 2 || (input.recovery.sleepQuality ?? 5) <= 2)) return { level: "TRAIN WITH CAUTION", message: "Your reported recovery is below baseline. Keep effort conservative today." };
  if (input.pain || input.fatigue && (input.recovery?.recoveryScore ?? 100) < 40) return { level: "RECOVERY PRIORITY", message: "Recovery is the priority today. Rest or keep movement easy." };
  if (input.fatigue || input.recentStrain !== undefined && input.recentStrain > 17 || input.recovery?.recoveryScore !== undefined && input.recovery.recoveryScore < 67) return { level: "TRAIN WITH CAUTION", message: "Train, but keep selection and effort conservative today." };
  return { level: "READY", message: "Good to train. Proceed with today’s plan." };
}

export function adaptSession(input: ReadinessInput & { lowerBodyDemand?: boolean; plannedSets: number }): SessionAdaptation {
  const readiness = assessReadiness(input);
  if (readiness.level === "RECOVERY PRIORITY") return { ...readiness, action: "rest", reduceSetsBy: input.plannedSets, cardioMinutes: 30 };
  if (readiness.level === "TRAIN WITH CAUTION") return { ...readiness, action: "reduce_demand", reduceSetsBy: Math.max(1, Math.ceil(input.plannedSets * .2)), cardioMinutes: input.lowerBodyDemand ? 30 : 35 };
  return { ...readiness, action: "proceed", cardioMinutes: 40 };
}

export function detectStall(exposures: Exposure[], replacement: string): StallProposal {
  const comparable = exposures.filter(item => item.comparable).slice(-3); if (comparable.length < 3) return { proposed: false };
  const noImprovement = comparable.every((item, i) => i === 0 || item.reps <= comparable[i - 1].reps && (item.rir ?? 2) <= (comparable[i - 1].rir ?? 2));
  return noImprovement ? { proposed: true, replacement, temporarySessions: 2, message: `Performance has stalled across ${comparable.length} exposures. I suggest a temporary exercise swap for the next two sessions.` } : { proposed: false };
}

export type ExerciseRole = "primary_compound" | "secondary_compound" | "isolation" | "accessory";
const substitutions: Record<string, { role: ExerciseRole; replacement: string }> = { "incline-db-press": { role: "primary_compound", replacement: "Incline Machine Press" }, "barbell-row": { role: "primary_compound", replacement: "Chest-Supported DB Row" }, "hack-squat": { role: "secondary_compound", replacement: "Leg Press" }, rdl: { role: "secondary_compound", replacement: "Seated Hamstring Curl" }, "cable-lateral-raise": { role: "isolation", replacement: "DB Lateral Raise" }, "rope-triceps-pushdown": { role: "isolation", replacement: "V-bar Pushdown" } };
export function substitutionFor(exerciseId: string, reason: "pain" | "equipment" | "stall") { const option = substitutions[exerciseId]; if (!option) return undefined; return { ...option, temporary: reason !== "stall", reason: reason === "pain" ? "This keeps the training purpose while reducing the irritated movement." : reason === "equipment" ? "This preserves the same movement role with available equipment." : "This is a temporary two-session proposal, not a block rewrite." }; }

export function rescheduleWeek(sessions: PlannedSession[], completedIds: string[], missedId?: string): PlannedSession[] { return sessions.map(session => { if (completedIds.includes(session.id)) return { ...session, status: "completed" as SessionStatus }; if (session.id === missedId) return { ...session, status: "missed" as SessionStatus, reason: "missed" }; return session; }); }
