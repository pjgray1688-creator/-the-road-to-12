import type { PlannedSession, RecoverySnapshot, SessionStatus } from "./domain";
import type { Workout } from "./types";
import { taxonomyForExercise, weeklyVolume } from "./programming-v2";
import { allExercises } from "./workout";

export function sessionOutcome(workout: Workout): "completed" | "partial" | "discarded" | "active" {
  if (workout.outcome === "discarded") return "discarded";
  if (workout.outcome === "partial" || workout.status === "partial") return "partial";
  if (workout.status === "completed" || workout.completedAt) return "completed";
  return "active";
}
export function canCompleteWorkout(workout: Pick<Workout, "sets" | "cardio">) { return workout.sets.length > 0 || Boolean(workout.cardio); }
export function endWorkoutEarly(workout: Workout): Workout { return { ...workout, status: "partial", outcome: "partial", completedAt: new Date().toISOString() }; }
export function markPlannedSessionMissed(session: PlannedSession, reason?: string): PlannedSession { return { ...session, status: "missed", reason: reason as PlannedSession["reason"] }; }
export type AdherenceSummary = { planned: number; completed: number; partial: number; missed: number };
export function adherenceSummary(sessions: PlannedSession[], workouts: Workout[], overrides: Record<string, { status: SessionStatus }> = {}): AdherenceSummary {
  const result: AdherenceSummary = { planned: 0, completed: 0, partial: 0, missed: 0 };
  for (const session of sessions) { const workout = workouts.find(w => w.plannedSessionId === session.id && sessionOutcome(w) !== "discarded"); const status = overrides[session.id]?.status ?? session.status; if (status === "missed") result.missed++; else if (workout && sessionOutcome(workout) === "partial") result.partial++; else if (workout && sessionOutcome(workout) === "completed") result.completed++; else result.planned++; }
  return result;
}
export type SalvageProposal = { title: string; detail: string; additions: Array<{ sessionId: string; exerciseId: string; sets: number }>; requiresApproval: true };
export function planMissedSessionSalvage(missed: PlannedSession, remaining: PlannedSession[], workouts: Workout[], profile: import("./training-profile").TrainingProfile, recovery?: RecoverySnapshot): SalvageProposal | undefined {
  if (recovery?.recoveryScore !== undefined && recovery.recoveryScore < 45) return undefined;
  const catalogue = allExercises(); const missing = missed.exerciseIds.map(id => catalogue.find(e => e.id === id)).filter(Boolean).map(e => taxonomyForExercise(e!));
  const current = weeklyVolume(remaining); const candidate = remaining.find(s => s.status === "planned" && s.exerciseIds.length > 0 && s.id !== missed.id);
  if (!candidate) return undefined;
  const additions: SalvageProposal["additions"] = []; for (const tax of missing) { const key = tax.muscles[0] === "lats" ? "back_width" : tax.muscles[0] === "upper back" ? "back_thickness" : tax.muscles[0]; if ((current[key] ?? 0) >= (profile.experience === "beginner" ? 14 : 22)) continue; const exercise = candidate.exerciseIds.map(id => catalogue.find(e => e.id === id)).find(e => e && taxonomyForExercise(e).muscles.includes(tax.muscles[0])); if (exercise) additions.push({ sessionId: candidate.id, exerciseId: exercise.id, sets: 1 }); }
  if (!additions.length) return undefined;
  return { title: "A modest catch-up option", detail: `You missed ${missed.name}. I can add a small amount to ${candidate.name} without recreating the whole session.`, additions, requiresApproval: true };
}
