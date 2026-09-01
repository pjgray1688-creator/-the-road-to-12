import type { CoachDecision, Equipment, Exercise, LoggedSet, SetKind } from "./types";
import { parseRange } from "./workout";
import { magnitudeLoad, rampLoad } from "./progression";

export function loadIncrement(equipment: Equipment, configured?: number) { if (equipment === "dumbbell") return 2; if (equipment === "barbell") return 2.5; return configured ?? (equipment === "machine" ? 5 : 2.5); }
export function practicalLoad(raw: number, equipment: Equipment, configured?: number, direction: "nearest" | "up" | "down" = "nearest") { const increment = loadIncrement(equipment, configured); const units = raw / increment; const rounded = direction === "up" ? Math.ceil(units) : direction === "down" ? Math.floor(units) : Math.round(units); return Math.max(increment, Math.round(rounded * increment * 100) / 100); }
export function snapAvailableLoad(raw: number, exercise: Exercise, direction: "nearest" | "up" | "down" = "nearest") { const values = exercise.validLoads?.slice().sort((a, b) => a - b); if (!values?.length) return practicalLoad(raw, exercise.equipment, exercise.stackIncrement, direction); if (direction === "up") return values.find(value => value >= raw) ?? values.at(-1)!; if (direction === "down") return [...values].reverse().find(value => value <= raw) ?? values[0]; return values.reduce((best, value) => Math.abs(value - raw) < Math.abs(best - raw) ? value : best, values[0]); }
export function nextPracticalLoad(current: number, exercise: Exercise, direction: "up" | "down") { const step = loadIncrement(exercise.equipment, exercise.stackIncrement); return snapAvailableLoad(current + (direction === "up" ? step : -step), exercise, direction); }
export function restFor(exercise: Exercise, kind: SetKind, hard = false) { const base = kind === "warmup" ? 45 : kind === "ramp" ? 60 : exercise.restSeconds; return hard ? Math.min(base + 30, 180) : base; }

/** Estimated lifting time in minutes, excluding cardio. Preparation is kept
 * deliberately light; this estimates the programmed working sets plus normal
 * execution, rest, and transitions so Coach can respect a practical time budget. */
export function estimateLiftingDuration(exercises: Exercise[], executionSeconds = 40, transitionSeconds = 90) {
  const seconds = exercises.reduce((total, exercise) => {
    const sets = Math.max(0, exercise.sets);
    return total + sets * executionSeconds + Math.max(0, sets - 1) * exercise.restSeconds;
  }, 0) + Math.max(0, exercises.length - 1) * transitionSeconds;
  return Math.ceil(seconds / 60);
}

/** Only completed working sets are performance evidence. Preparation sets are never history. */
export const workingHistory = (previous: LoggedSet[]) => previous.filter(set => set.kind === "working");
export type SessionAssessment = "progress" | "hold" | "reduce" | "very_easy";
export function assessWorkingSession(exercise: Exercise, sets: LoggedSet[]): SessionAssessment {
  const work = workingHistory(sets); if (!work.length) return "hold";
  const { low, high } = parseRange(exercise.target); const inRange = work.filter(set => set.reps >= low && set.reps <= high).length;
  const easy = work.filter(set => set.reps >= high && (set.rir ?? 2) >= 3).length;
  const hard = work.filter(set => set.reps < low || (set.rir ?? 2) <= 0).length;
  if (hard >= Math.ceil(work.length / 2) || (work.length > 1 && work.at(-1)!.reps < work[0].reps - 2)) return "reduce";
  // A single good set is not enough to establish next-session progression;
  // assess the completed session as a whole when multiple working sets exist.
  if (work.length >= 2 && easy >= Math.ceil(work.length * .7)) return "very_easy";
  if (work.length >= 2 && inRange === work.length && work.filter(set => set.reps >= high).length >= Math.ceil(work.length * .6) && work.every(set => (set.rir ?? 2) >= 1)) return "progress";
  return "hold";
}
export function workingWeight(exercise: Exercise, previous: LoggedSet[]) {
  const history = workingHistory(previous);
  const reference = history.at(0);
  if (!reference) return snapAvailableLoad(exercise.defaultWorkingWeight, exercise);
  const assessment = assessWorkingSession(exercise, history);
  if (assessment === "progress") return nextPracticalLoad(reference.weight, exercise, "up");
  if (assessment === "very_easy") return nextPracticalLoad(nextPracticalLoad(reference.weight, exercise, "up"), exercise, "up");
  if (assessment === "reduce") {
    // Use the final working load as the sustainable reference after a collapse,
    // then take one conservative equipment-valid step down.
    const sustainable = history.at(-1)!.weight;
    return nextPracticalLoad(sustainable, exercise, "down");
  }
  // Preserve the user's genuine historical load when holding or recovering;
  // only newly calculated progressions should be snapped to equipment steps.
  return reference.weight;
}
export function startingPrescription(exercise: Exercise, previous: LoggedSet[], position = 0) { const work = workingWeight(exercise, previous); const history = workingHistory(previous); const isolation = exercise.purpose === "isolation" || exercise.purpose === "core"; const warmupRequired = !isolation && position === 0; const ramps = isolation ? 1 : position === 0 && history.length === 0 ? 2 : 1; return { warmupRequired, ramps, warmup: snapAvailableLoad(work * .5, exercise, "down"), rampOne: snapAvailableLoad(work * .75, exercise), rampTwo: snapAvailableLoad(work * .9, exercise), work }; }
export function initialCoachPlan(exercise: Exercise, previous: LoggedSet[], position = 0) { const plan = startingPrescription(exercise, previous, position); const kind: SetKind = plan.warmupRequired ? "warmup" : "ramp"; const weight = kind === "warmup" ? plan.warmup : plan.rampOne; return { kind, weight, reps: kind === "warmup" ? "10–12" : "6–8", detail: plan.warmupRequired ? `Start with ${weight}kg for 10–12 easy reps, then we will calibrate the ramp.` : `Start with ${weight}kg for a brief calibration set. We are keeping preparation efficient.` }; }
export function nextExerciseRecommendation(exercise: Exercise, previous: LoggedSet[], position = 0) { const weight = workingWeight(exercise, previous); const history = workingHistory(previous); const previousLine = history[0] ? `${history[0].weight}kg × ${history[0].reps}` : "No logged performance yet"; const plan = startingPrescription(exercise, previous, position); return { weight, previousLine, firstStep: initialCoachPlan(exercise, previous, position), reason: history[0] ? `Your last working reference was ${previousLine}; we will use it as a reference and calibrate quickly.` : `Using an experienced-lifter baseline for this movement. ${plan.warmupRequired ? "A short warm-up and ramps will establish today’s working load." : "A brief calibration set will establish today’s working load."}` }; }

/**
 * Preparation sets can confirm that the movement is ready to continue, but their
 * prescribed reps (and any stale RIR field) are not performance evidence. The
 * only preparation-load exception is an explicitly user-selected load that is
 * substantially above the plan; that is treated as an override, not history.
 */
function preparationTarget(baseline: number, latest: LoggedSet, exercise: Exercise) {
  return latest.weight >= baseline * 1.15 ? snapAvailableLoad(latest.weight, exercise) : baseline;
}

function recalibratedTarget(exercise: Exercise, previous: LoggedSet[], latest: LoggedSet) { const baseline = workingWeight(exercise, previous); const effort = latest.rir ?? 2; if (latest.weight < baseline * .75) return baseline; if (effort >= 3 && latest.reps >= 8) return magnitudeLoad(exercise, latest.weight, latest.reps, parseRange(exercise.target).high, effort); if (effort <= 0) return nextPracticalLoad(latest.weight, exercise, "down"); return snapAvailableLoad(latest.weight, exercise); }
export function evaluateSet(exercise: Exercise, logged: LoggedSet[], feedback = "", previous: LoggedSet[] = [], position = 0): CoachDecision {
  const latest = logged.at(-1); if (!latest) throw new Error("A logged set is required"); const { low, high } = parseRange(exercise.target); const f = feedback.toLowerCase(); const working = logged.filter(s => s.kind === "working"); const hard = (latest.kind === "working" && (latest.rir ?? 2) <= 1) || f.includes("hard") || f.includes("brutal") || f.includes("fatigue"); const base = { repTarget: `${low}–${high}`, restSeconds: restFor(exercise, latest.kind, hard), workingSetsCompleted: working.length };
  if (f.includes("shoulder") || f.includes("pain")) return { ...base, title: "Protect the joint", detail: "Stop this movement today. Use a pain-free substitute rather than pushing through pain.", nextWeight: latest.weight, tone: "reduce", nextKind: "complete", completed: false };
  const plan = startingPrescription(exercise, previous, position); const nonWorking = logged.filter(s => s.kind !== "working"); const baseline = workingWeight(exercise, previous); const target = latest.kind === "working" ? recalibratedTarget(exercise, previous, latest) : preparationTarget(baseline, latest, exercise);
  if (latest.kind === "warmup") return { ...base, title: "Warm-up assessed", detail: latest.weight >= plan.work * .8 ? `That was much nearer working weight than planned. Go to ${target}kg for a short ramp, then we will establish work.` : `Go to ${plan.rampOne}kg for 6–8 reps.`, nextWeight: latest.weight >= plan.work * .8 ? target : plan.rampOne, repTarget: "6–8", tone: "hold", nextKind: "ramp", completed: false };
  if (latest.kind === "ramp") { const rampCount = nonWorking.filter(s => s.kind === "ramp").length; const enoughRamp = exercise.purpose === "isolation" || exercise.purpose === "core" || latest.weight >= target * .85 || rampCount >= plan.ramps; if (enoughRamp) return { ...base, title: "Working weight established", detail: `Go to ${target}kg. Working set 1 of ${exercise.sets}: aim for ${low}–${high} controlled reps.`, nextWeight: target, tone: "hold", nextKind: "working", completed: false }; const nextRamp = rampLoad(exercise, latest.weight, target); return { ...base, title: "One final ramp", detail: `Go to ${nextRamp}kg for 4–6 reps, then we start working sets.`, nextWeight: nextRamp, repTarget: "4–6", tone: "hold", nextKind: "ramp", completed: false }; }
  if (working.length >= exercise.sets) return { ...base, title: "Exercise complete", detail: `${exercise.sets}/${exercise.sets} working sets completed. Move to the next programmed exercise.`, nextWeight: latest.weight, tone: "hold", nextKind: "complete", completed: true };
  const nextNumber = working.length + 1;
  if (latest.reps >= high && (latest.rir ?? 2) >= 2) { const next = magnitudeLoad(exercise, latest.weight, latest.reps, high, latest.rir); return { ...base, title: "Increase load", detail: `Go to ${next}kg for working set ${nextNumber} of ${exercise.sets}.`, nextWeight: next, tone: "progress", nextKind: "working", completed: false }; }
  if (latest.reps < low && (latest.rir ?? 2) <= 1 && working.length >= 1) return { ...base, title: "Manage fatigue", detail: `Drop to ${nextPracticalLoad(latest.weight, exercise, "down")}kg and finish with clean reps.`, nextWeight: nextPracticalLoad(latest.weight, exercise, "down"), tone: "reduce", nextKind: "working", completed: false };
  return { ...base, title: "Stay at this load", detail: `Stay at ${latest.weight}kg for working set ${nextNumber} of ${exercise.sets}.`, nextWeight: latest.weight, tone: "hold", nextKind: "working", completed: false };
}
export function cardioRecommendation(workingSets: number, difficultSets: number) { if (difficultSets >= 6) return { duration: 30, incline: 5, speed: 4.6, why: "High weights-session demand today. Keep the cardio moderate to protect recovery." }; if (difficultSets >= 4 || workingSets >= 20) return { duration: 35, incline: 6, speed: 4.8, why: "This was a demanding session, so reduce cardio intensity meaningfully." }; return { duration: 40, incline: 8, speed: 5, why: "Normal session demand: complete the standard conditioning block." }; }
