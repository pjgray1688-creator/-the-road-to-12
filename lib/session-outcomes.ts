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
export type SalvageEvidenceCode = "MISSED_SESSION" | "PARTIAL_SESSION" | "RECOVERY" | "WEEKLY_VOLUME" | "FATIGUE" | "EXERCISE_ROLE" | "PROGRAMME_PRIORITY" | "SCHEDULE_CONSTRAINT" | "COMPATIBLE_EXPOSURE" | "NO_COMPATIBLE_SLOT";
export type SalvageEvidence = { code: SalvageEvidenceCode; detail: string };
export type SalvageProposal = { title: string; detail: string; additions: Array<{ sessionId: string; exerciseId: string; sets: number }>; notRecovered?: string[]; evidence: SalvageEvidence[]; requiresApproval: true };
const keyForMuscle = (muscle: string) => ({ lats: "back_width", "upper back": "back_thickness", "front delts": "shoulders", "lateral delts": "shoulders", "rear delts": "shoulders", biceps: "arms", triceps: "arms", abs: "core" }[muscle] ?? muscle);
const reasonText = (reason?: string) => reason?.toLowerCase() ?? "";
export function planMissedSessionSalvage(missed: PlannedSession, remaining: PlannedSession[], workouts: Workout[], profile: import("./training-profile").TrainingProfile, recovery?: RecoverySnapshot, missedReason?: string): SalvageProposal {
  const evidence: SalvageEvidence[] = [{ code: missed.status === "partial" ? "PARTIAL_SESSION" : "MISSED_SESSION", detail: `${missed.name} was ${missed.status === "partial" ? "partly completed" : "missed"}.` }];
  const catalogue = allExercises();
  const missedExercises = missed.exerciseIds.map(id => catalogue.find(e => e.id === id)).filter(Boolean).map(exercise => ({ exercise: exercise!, taxonomy: taxonomyForExercise(exercise!) }));
  const performed = new Set(workouts.filter(workout => workout.plannedSessionId === missed.id && workout.outcome !== "discarded").flatMap(workout => workout.sets.map(set => set.exerciseId)));
  const missing = missedExercises.filter(item => !performed.has(item.exercise.id));
  if (performed.size) evidence.push({ code: "PARTIAL_SESSION", detail: `${performed.size} prescribed exercise${performed.size === 1 ? " was" : "s were"} already performed and will not be prescribed again.` });
  if (!missing.length) return { title: "No catch-up needed", detail: "The meaningful work from this session is already recorded, so I would leave the rest of the week unchanged.", additions: [], notRecovered: [], evidence, requiresApproval: true };
  const candidates = remaining.filter(session => session.status === "planned" && session.exerciseIds.length > 0 && session.id !== missed.id).map((session, index) => {
    const exercises = session.exerciseIds.map(id => catalogue.find(e => e.id === id)).filter(Boolean).map(exercise => ({ exercise: exercise!, taxonomy: taxonomyForExercise(exercise!) }));
    const matches = missing.flatMap(item => exercises.filter(candidate => candidate.taxonomy.muscles.some(muscle => item.taxonomy.muscles.includes(muscle))).map(candidate => ({ item, candidate })));
    const score = matches.length * 100 + new Set(matches.map(match => keyForMuscle(match.item.taxonomy.muscles[0]))).size * 20 - index;
    return { session, exercises, matches, score, index };
  }).sort((a, b) => b.score - a.score);
  if (!candidates.length || !candidates[0].matches.length) {
    evidence.push({ code: "NO_COMPATIBLE_SLOT", detail: "No remaining planned session contains compatible exposure." });
    return { title: "No catch-up recommended", detail: "I wouldn't try to recover this session this week because there is no compatible remaining training slot.", additions: [], notRecovered: missing.map(item => item.exercise.name), evidence, requiresApproval: true };
  }
  const candidate = candidates[0];
  evidence.push({ code: "COMPATIBLE_EXPOSURE", detail: `${candidate.session.name} contains compatible preparation or accessory work.` }, { code: "SCHEDULE_CONSTRAINT", detail: "Later sessions were compared in chronological order and ranked by compatible exposure." });
  const volumes = weeklyVolume(remaining);
  const cap = profile.experience === "beginner" ? 14 : 22;
  const reason = reasonText(missedReason);
  const pain = /pain|injury|unwell|illness/.test(reason);
  const recoveryLow = recovery?.recoveryScore !== undefined && recovery.recoveryScore < 45;
  if (recoveryLow) evidence.push({ code: "RECOVERY", detail: `Current recovery is ${recovery?.recoveryScore}%; later-week work is being kept modest.` }, { code: "FATIGUE", detail: "Heavy missed work is not being recreated." });
  if (pain) {
    evidence.push({ code: "RECOVERY", detail: "The missed reason indicates discomfort or illness, so the same movement is not redistributed." });
    return { title: "No catch-up recommended", detail: "I wouldn't redistribute the missed movement while discomfort or illness is part of the reason. Leave it missed and reassess when you're ready.", additions: [], notRecovered: missing.map(item => item.exercise.name), evidence, requiresApproval: true };
  }
  const limit = recoveryLow || /recovery|fatigue/.test(reason) ? 1 : /work|time/.test(reason) ? 2 : 2;
  const additions: SalvageProposal["additions"] = [];
  const used = new Set<string>();
  for (const match of candidate.matches) {
    const key = keyForMuscle(match.item.taxonomy.muscles[0]);
    if (additions.length >= limit || used.has(match.candidate.exercise.id) || (volumes[key] ?? 0) >= cap) continue;
    used.add(match.candidate.exercise.id); additions.push({ sessionId: candidate.session.id, exerciseId: match.candidate.exercise.id, sets: 1 });
  }
  if (!additions.length) {
    evidence.push({ code: "WEEKLY_VOLUME", detail: "Remaining exposure is already at the planned upper boundary." });
    return { title: "No catch-up recommended", detail: "I wouldn't add more this week because the compatible exposure is already near its planned volume limit.", additions: [], notRecovered: missing.map(item => item.exercise.name), evidence, requiresApproval: true };
  }
  evidence.push({ code: "WEEKLY_VOLUME", detail: "Only a modest number of sets fit within the weekly volume boundary." }, { code: "EXERCISE_ROLE", detail: "Accessory exposure is preferred; heavy primary work remains missed." });
  const notRecovered = missing.filter(item => item.taxonomy.fatigue === "high" || /deadlift|squat/i.test(item.exercise.name)).map(item => item.exercise.name);
  return { title: "A modest catch-up option", detail: `You missed ${missed.name}. ${candidate.session.name} ranked highest because it already contains compatible work, so I can add a small amount there without recreating the whole session.`, additions, notRecovered, evidence, requiresApproval: true };
}
