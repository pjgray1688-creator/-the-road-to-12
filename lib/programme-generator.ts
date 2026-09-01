import type { PlannedSession, TrainingBlock } from "./domain";
import type { Exercise } from "./types";
import { allExercises } from "./workout";
import type { TrainingProfile } from "./training-profile";
import { disciplineForProfile } from "./training-architecture";
import { prescriptionForExercise } from "./prescription";
import { exerciseKnowledge } from "./exercise-library";
import { conditioningFor, frameworkFor, frameworkTemplates, priorityMatches, validateProgramme } from "./programming-v2";

export type GeneratedProgramme = { id: string; name: string; profile: TrainingProfile; discipline?: import("./training-profile").TrainingDiscipline; block: TrainingBlock; week: PlannedSession[]; rationale: string; previousProgrammes?: GeneratedProgramme[]; isLegacy?: boolean; framework?: string; conditioning?: import("./domain").ConditioningPrescription[]; generationVersion?: string };
const daySets: Record<number, number[]> = { 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6] };
function compatible(exercise: Exercise, profile: TrainingProfile) { if (profile.environment === "full_gym") return true; if (profile.environment === "limited_gym") return (exercise.equipment !== "machine" && exercise.equipment !== "cable") || exercise.id === "lat-pulldown"; if (profile.environment === "home_basic") return exercise.equipment === "dumbbell" || exercise.equipment === "barbell"; return exercise.equipment === "machine" && exercise.loadingProfile === "bodyweight_assisted"; }
function avoided(exercise: Exercise, profile: TrainingProfile) { const text = profile.limitations.concat(profile.dislikedExercises ?? [], profile.avoidedExercises ?? []).join(" ").toLowerCase(); const knowledge = exerciseKnowledge(exercise.id); const pattern = `${exercise.name} ${knowledge?.movementPattern ?? ""} ${(knowledge?.primaryMuscles ?? []).join(" ")}`.toLowerCase(); return (text.includes("knee") && (pattern.includes("quad") || pattern.includes("leg") || /squat|lunge|knee/.test(pattern))) || (text.includes("shoulder") && pattern.includes("shoulder")) || [...(profile.dislikedExercises ?? []), ...(profile.avoidedExercises ?? [])].some(item => item.toLowerCase() === exercise.id || item.toLowerCase() === exercise.name.toLowerCase()); }
function prescribe(id: string, profile: TrainingProfile, catalogue: Exercise[], position: number) { const exercise = catalogue.find(item => item.id === id) ?? allExercises().find(item => item.id === id); if (!exercise || !compatible(exercise, profile) || avoided(exercise, profile)) return undefined; const p = prescriptionForExercise(exercise, profile, position); return { ...exercise, sets: p.sets, target: p.target }; }
export function generateTrainingProgramme(profile: TrainingProfile, catalogue: Exercise[] = allExercises(), generationId = "default"): GeneratedProgramme {
  const days = daySets[profile.daysPerWeek] ?? daySets[3]; const framework = frameworkFor(profile); const source = frameworkTemplates(framework); const id = `generated-${profile.goal}-${profile.daysPerWeek}-${generationId}`;
  const week: PlannedSession[] = days.map((day, index) => {
    let ids = source[index % source.length];
    const wanted = (profile.wantedExercises ?? []).map(x => catalogue.find(e => e.id === x || e.name.toLowerCase() === x.toLowerCase())?.id).filter(Boolean) as string[];
    if (wanted.length) ids = [...wanted, ...ids.filter(x => !wanted.includes(x))];
    const priorities = (profile.priorities ?? []).filter(x => x !== "balanced");
    if (priorities.length) ids = [...ids.filter(x => { const e = catalogue.find(item => item.id === x); return e && priorities.some(p => priorityMatches(e, p)); }), ...ids.filter(x => { const e = catalogue.find(item => item.id === x); return !e || !priorities.some(p => priorityMatches(e, p)); })];
    const cap = profile.sessionMinutes <= 45 || profile.experience === "beginner" ? 5 : 7;
    const selected = ids.map((x, position) => prescribe(x, profile, catalogue, position)).filter((x): x is Exercise => Boolean(x)).filter((x, i, a) => a.findIndex(y => y.id === x.id) === i).slice(0, cap);
    const overrides = Object.fromEntries(selected.map(e => [e.id, { sets: e.sets, target: e.target }]));
    const name = framework === "full_body_ab" ? `Full Body ${index % 2 ? "B" : "A"}` : framework === "upper_lower" ? (index % 2 ? "Lower Body" : "Upper Body") : framework === "ppl_plus" ? ["Push A", "Pull A", "Legs", "Upper B", "Lower B"][index % 5] : ["Push A", "Pull A", "Legs A", "Push B", "Pull B", "Legs B"][index % 6];
    return { id: `${id}-day-${day}`, day, name, status: "planned", exerciseIds: selected.map(e => e.id), exerciseOverrides: overrides };
  });
  const validation = validateProgramme(week, profile); if (!validation.valid && validation.issues.includes("duplicate-exercise")) throw new Error("Generated programme contains duplicate exercises");
  const weeks = 4; const block: TrainingBlock = { id: `${id}-block`, name: profile.goal === "muscle_gain" ? "Build Muscle" : profile.goal === "strength" ? "Build Strength" : profile.goal === "fat_loss" ? "Strength & Definition" : "Foundations", startDate: new Date().toISOString().slice(0, 10), endDate: new Date(Date.now() + weeks * 7 * 86400000).toISOString().slice(0, 10), weekNumber: 1, totalWeeks: weeks, framework, goals: [profile.goal], progressionFocus: "Build consistent quality before adding load", status: "proposed", reviewDate: new Date(Date.now() + weeks * 7 * 86400000).toISOString().slice(0, 10) };
  const conditioning = conditioningFor(profile, days); const priorityText = (profile.priorities ?? []).filter(x => x !== "balanced").slice(0, 1).map(x => `${x.replace("_", " ")} emphasis`).join("");
  return { id, name: block.name, profile, discipline: disciplineForProfile(profile), block, week, conditioning, framework, generationVersion: "v2", rationale: `Built around ${profile.daysPerWeek} training days, ${profile.goal.replace("_", " ")}, and ${profile.sessionMinutes}-minute sessions${priorityText ? ` with ${priorityText}` : ""}. Compound lifts anchor each session, with purposeful accessory and core work.` };
}
