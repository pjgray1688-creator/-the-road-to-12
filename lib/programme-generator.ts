import type { PlannedSession, TrainingBlock } from "./domain";
import type { Exercise } from "./types";
import { allExercises } from "./workout";
import type { TrainingProfile } from "./training-profile";
import { disciplineForProfile } from "./training-architecture";
import { prescriptionForExercise } from "./prescription";
import { exerciseKnowledge } from "./exercise-library";
import { conditioningFor, frameworkFor, frameworkTemplates, priorityMatches, validateProgramme } from "./programming-v2";
import { taxonomyForExercise } from "./programming-v2";

export type GeneratedProgramme = { id: string; name: string; profile: TrainingProfile; discipline?: import("./training-profile").TrainingDiscipline; block: TrainingBlock; week: PlannedSession[]; rationale: string; previousProgrammes?: GeneratedProgramme[]; isLegacy?: boolean; framework?: string; conditioning?: import("./domain").ConditioningPrescription[]; generationVersion?: string };
const daySets: Record<number, number[]> = { 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6] };
export function programmeTrainingDays(profile: TrainingProfile): number[] {
  const defaults = daySets[profile.daysPerWeek] ?? daySets[3];
  if (profile.availabilityMode !== "fixed_days") return defaults;
  const explicit = [...new Set([...(profile.availableDays ?? []), ...(profile.preferredDays ?? [])])]
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    .sort((a, b) => a - b);
  return (explicit.length ? explicit : defaults).slice(0, profile.daysPerWeek);
}
function compatible(exercise: Exercise, profile: TrainingProfile) { if (profile.environment === "full_gym") return true; if (profile.environment === "limited_gym") return (exercise.equipment !== "machine" && exercise.equipment !== "cable") || exercise.id === "lat-pulldown"; if (profile.environment === "home_basic") return exercise.equipment === "dumbbell" || exercise.equipment === "barbell"; return exercise.equipment === "machine" && exercise.loadingProfile === "bodyweight_assisted"; }
function avoided(exercise: Exercise, profile: TrainingProfile) { const text = profile.limitations.concat(profile.dislikedExercises ?? [], profile.avoidedExercises ?? []).join(" ").toLowerCase(); const knowledge = exerciseKnowledge(exercise.id); const pattern = `${exercise.name} ${knowledge?.movementPattern ?? ""} ${(knowledge?.primaryMuscles ?? []).join(" ")}`.toLowerCase(); return (text.includes("knee") && (pattern.includes("quad") || pattern.includes("leg") || /squat|lunge|knee/.test(pattern))) || (text.includes("shoulder") && pattern.includes("shoulder")) || [...(profile.dislikedExercises ?? []), ...(profile.avoidedExercises ?? [])].some(item => item.toLowerCase() === exercise.id || item.toLowerCase() === exercise.name.toLowerCase()); }
function prescribe(id: string, profile: TrainingProfile, catalogue: Exercise[], position: number) { const exercise = catalogue.find(item => item.id === id) ?? allExercises().find(item => item.id === id); if (!exercise || !compatible(exercise, profile) || avoided(exercise, profile)) return undefined; const p = prescriptionForExercise(exercise, profile, position); return { ...exercise, sets: p.sets, target: p.target }; }
function sessionFitsPreference(name: string, exercise: Exercise, framework: ReturnType<typeof frameworkFor>, index: number) {
  const session = name.toLowerCase(); const muscles = taxonomyForExercise(exercise).muscles.join(" ").toLowerCase();
  if (framework === "full_body_ab") return index === 0;
  const lowerFocus = /quad|glute|hamstring|calf|leg|hip/.test(muscles);
  if (framework === "upper_lower") return lowerFocus ? /lower|leg/.test(session) : /upper/.test(session);
  if (framework === "ppl_plus" || framework === "ppl_ab") {
    if (lowerFocus) return /leg|lower/.test(session);
    if (/chest|shoulder|triceps/.test(muscles)) return /push|upper/.test(session);
    if (/back|lat|biceps|forearm/.test(muscles)) return /pull|upper/.test(session);
    return /upper/.test(session);
  }
  return false;
}

/** Repair generated sessions at programme scope: never repeat an exercise in a session,
 * retain avoidance/equipment constraints, and place a preference in at most one suitable day. */
export function repairGeneratedProgramme(week: PlannedSession[], profile: TrainingProfile, catalogue = allExercises()) {
  const preferredIds = new Set((profile.wantedExercises ?? []).map(value => catalogue.find(item => item.id === value || item.name.toLowerCase() === value.toLowerCase())?.id).filter((id): id is string => Boolean(id)));
  const repaired = week.map(session => {
    const seen = new Set<string>();
    const exerciseIds = session.exerciseIds.filter(id => {
      const exercise = catalogue.find(item => item.id === id) ?? allExercises().find(item => item.id === id);
      if (!exercise || preferredIds.has(id) || seen.has(id) || !compatible(exercise, profile) || avoided(exercise, profile)) return false;
      seen.add(id); return true;
    });
    return { ...session, exerciseIds, exerciseOverrides: Object.fromEntries(Object.entries(session.exerciseOverrides ?? {}).filter(([id]) => exerciseIds.includes(id))) };
  });
  for (const id of preferredIds) {
    const exercise = catalogue.find(item => item.id === id);
    if (!exercise || !compatible(exercise, profile) || avoided(exercise, profile)) continue;
    const target = repaired.findIndex((session, index) => sessionFitsPreference(session.name, exercise, frameworkFor(profile), index) && session.exerciseIds.length < (profile.experience === "beginner" || profile.sessionMinutes <= 45 ? 6 : 8));
    if (target < 0) continue;
    const prescribed = prescribe(id, profile, catalogue, repaired[target].exerciseIds.length);
    if (!prescribed) continue;
    repaired[target] = { ...repaired[target], exerciseIds: [...repaired[target].exerciseIds, id], exerciseOverrides: { ...repaired[target].exerciseOverrides, [id]: { sets: prescribed.sets, target: prescribed.target } } };
  }
  return repaired;
}

export function generateTrainingProgramme(profile: TrainingProfile, catalogue: Exercise[] = allExercises(), generationId = "default"): GeneratedProgramme {
  const days = programmeTrainingDays(profile); const framework = frameworkFor(profile); const source = frameworkTemplates(framework); const id = `generated-${profile.goal}-${profile.daysPerWeek}-${generationId}`;
  const week: PlannedSession[] = days.map((day, index) => {
    let ids = source[index % source.length];
    const priorities = (profile.priorities ?? []).filter(x => x !== "balanced");
    if (priorities.length) ids = [...ids.filter(x => { const e = catalogue.find(item => item.id === x); return e && priorities.some(p => priorityMatches(e, p)); }), ...ids.filter(x => { const e = catalogue.find(item => item.id === x); return !e || !priorities.some(p => priorityMatches(e, p)); })];
    const cap = profile.sessionMinutes <= 45 || profile.experience === "beginner" ? 5 : 7;
    const selected = ids.map((x, position) => prescribe(x, profile, catalogue, position)).filter((x): x is Exercise => Boolean(x)).filter((x, i, a) => a.findIndex(y => y.id === x.id) === i).slice(0, cap);
    const overrides = Object.fromEntries(selected.map(e => [e.id, { sets: e.sets, target: e.target }]));
    const name = framework === "full_body_ab" ? `Full Body ${index % 2 ? "B" : "A"}` : framework === "upper_lower" ? (index % 2 ? "Lower Body" : "Upper Body") : framework === "ppl_plus" ? ["Push A", "Pull A", "Legs", "Upper B", "Lower B"][index % 5] : ["Push A", "Pull A", "Legs A", "Push B", "Pull B", "Legs B"][index % 6];
    return { id: `${id}-day-${day}`, day, name, status: "planned", exerciseIds: selected.map(e => e.id), exerciseOverrides: overrides };
  });
  const repairedWeek = repairGeneratedProgramme(week, profile, catalogue);
  const validation = validateProgramme(repairedWeek, profile); if (validation.issues.includes("duplicate-exercise") || validation.issues.includes("session-too-large")) throw new Error(`Generated programme could not be repaired: ${validation.issues.join(", ")}`);
  const weeks = 4; const block: TrainingBlock = { id: `${id}-block`, name: profile.goal === "muscle_gain" ? "Build Muscle" : profile.goal === "strength" ? "Build Strength" : profile.goal === "fat_loss" ? "Strength & Definition" : "Foundations", startDate: new Date().toISOString().slice(0, 10), endDate: new Date(Date.now() + weeks * 7 * 86400000).toISOString().slice(0, 10), weekNumber: 1, totalWeeks: weeks, framework, goals: [profile.goal], progressionFocus: "Build consistent quality before adding load", status: "proposed", reviewDate: new Date(Date.now() + weeks * 7 * 86400000).toISOString().slice(0, 10) };
  const conditioning = conditioningFor(profile, days); const priorityText = (profile.priorities ?? []).filter(x => x !== "balanced").slice(0, 1).map(x => `${x.replace("_", " ")} emphasis`).join("");
  return { id, name: block.name, profile, discipline: disciplineForProfile(profile), block, week: repairedWeek, conditioning, framework, generationVersion: "v2", rationale: `Built around ${profile.daysPerWeek} training days, ${profile.goal.replace("_", " ")}, and ${profile.sessionMinutes}-minute sessions${priorityText ? ` with ${priorityText}` : ""}. Compound lifts anchor each session, with purposeful accessory and core work.` };
}
