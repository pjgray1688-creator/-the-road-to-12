import type { ConditioningPrescription, PlannedSession } from "./domain";
import type { Exercise } from "./types";
import type { TrainingProfile, TrainingPriority } from "./training-profile";
import { exerciseKnowledge } from "./exercise-library";
import { allExercises } from "./workout";

export type ExerciseTaxonomy = {
  movement: string; muscles: string[]; role: "primary" | "secondary" | "accessory" | "isolation" | "core";
  compound: boolean; unilateral: boolean; familiarity: "foundation" | "variation"; fatigue: "low" | "medium" | "high";
  family: string;
};

const muscleAliases: Record<string, string> = { lats: "back_width", "upper back": "back_thickness", "spinal erectors": "hamstrings", "front delts": "shoulders", "lateral delts": "shoulders", "rear delts": "shoulders", biceps: "arms", brachialis: "arms", triceps: "arms", "triceps long head": "arms", abs: "core", obliques: "core", "glute medius": "glutes" };
export function taxonomyForExercise(exercise: Exercise): ExerciseTaxonomy {
  const knowledge = exerciseKnowledge(exercise.id);
  const role = knowledge?.programmeRole === "primary_compound" ? "primary" : knowledge?.programmeRole === "secondary_compound" ? "secondary" : exercise.purpose === "core" ? "core" : exercise.purpose === "isolation" ? "isolation" : "accessory";
  const inferred: Record<string, string[]> = { "hamstring-curl": ["hamstrings"], rdl: ["hamstrings", "glutes"], "trap-bar-deadlift": ["quads", "hamstrings", "glutes"], "leg-press": ["quads", "glutes"], "hack-squat": ["quads", "glutes"], calves: ["calves"], "flat-bench": ["chest"], "lat-pulldown": ["lats"], "barbell-row": ["upper back"], "rear-delt-fly": ["rear delts"], "cable-lateral-raise": ["lateral delts"], "hip-thrust": ["glutes"], "rope-triceps-pushdown": ["triceps"], "cable-crunch": ["abs"], "incline-db-press": ["upper chest"] };
  const muscles = knowledge?.primaryMuscles ?? inferred[exercise.id] ?? [exercise.target];
  return { movement: knowledge?.movementPattern ?? "general", muscles, role, compound: knowledge?.compound ?? exercise.purpose !== "isolation", unilateral: knowledge?.unilateral ?? false, familiarity: knowledge && ["trap-bar-deadlift", "flat-bench", "lat-pulldown", "leg-press", "barbell-row", "rdl"].includes(exercise.id) ? "foundation" : "variation", fatigue: knowledge?.axialLoading === "high" || knowledge?.hipHingeDemand === "high" ? "high" : knowledge?.compound ? "medium" : "low", family: knowledge?.substitutions?.[0] ?? knowledge?.movementPattern ?? exercise.id };
}

export type Framework = "full_body_ab" | "upper_lower" | "ppl_plus" | "ppl_ab";
export function frameworkFor(profile: TrainingProfile): Framework {
  if (profile.daysPerWeek <= 3) return "full_body_ab";
  if (profile.daysPerWeek === 4) return "upper_lower";
  if (profile.daysPerWeek === 5) return profile.experience === "beginner" ? "upper_lower" : "ppl_plus";
  return profile.experience === "beginner" ? "ppl_plus" : "ppl_ab";
}

const templates: Record<Framework, string[][]> = {
  full_body_ab: [
    ["flat-bench", "leg-press", "lat-pulldown", "rdl", "pallof-press"],
    ["trap-bar-deadlift", "incline-db-press", "hack-squat", "barbell-row", "dead-bug"]
  ],
  upper_lower: [
    ["flat-bench", "barbell-row", "incline-db-press", "lat-pulldown", "cable-lateral-raise", "cable-crunch"],
    ["trap-bar-deadlift", "leg-press", "hamstring-curl", "bulgarian-split-squat", "calves"],
    ["seated-db-shoulder-press", "chest-supported-db-row", "incline-machine-press", "straight-arm-pulldown", "face-pull", "incline-db-curl"],
    ["hack-squat", "romanian-deadlift", "hip-thrust", "leg-extension", "seated-hamstring-curl", "side-plank"]
  ],
  ppl_plus: [
    ["flat-bench", "incline-db-press", "cable-lateral-raise", "rope-triceps-pushdown", "cable-crunch"],
    ["lat-pulldown", "barbell-row", "rear-delt-fly", "incline-db-curl", "straight-arm-pulldown"],
    ["trap-bar-deadlift", "leg-press", "hamstring-curl", "bulgarian-split-squat", "calves", "pallof-press"],
    ["seated-db-shoulder-press", "chest-supported-db-row", "incline-machine-press", "machine-lateral-raise", "overhead-cable-triceps-extension"],
    ["hack-squat", "romanian-deadlift", "hip-thrust", "leg-extension", "seated-hamstring-curl", "dead-bug"]
  ],
  ppl_ab: [
    ["flat-bench", "incline-db-press", "machine-lateral-raise", "rope-triceps-pushdown", "cable-crunch"],
    ["lat-pulldown", "chest-supported-db-row", "rear-delt-fly", "incline-db-curl", "cable-shrug"],
    ["trap-bar-deadlift", "leg-press", "hamstring-curl", "bulgarian-split-squat", "calves", "pallof-press"],
    ["incline-machine-press", "barbell-overhead-press", "one-arm-db-row", "cable-fly", "overhead-cable-triceps-extension"],
    ["front-squat", "romanian-deadlift", "barbell-hip-thrust", "reverse-lunge", "seated-hamstring-curl", "side-plank"],
    ["hack-squat", "cable-row", "straight-arm-pulldown", "hammer-curl", "face-pull", "dead-bug"]
  ]
};
export function frameworkTemplates(framework: Framework) { return templates[framework]; }

export function priorityMatches(exercise: Exercise, priority: TrainingPriority) {
  const t = taxonomyForExercise(exercise); return t.muscles.some(m => muscleAliases[m] === priority || m === priority || (priority === "upper_chest" && m === "upper chest"));
}

export function conditioningFor(profile: TrainingProfile, trainingDays: number[]): ConditioningPrescription[] {
  if (!profile.includeCardio) return [];
  const frequency = profile.conditioningFrequency ?? (profile.goal === "fat_loss" ? 2 : 1);
  const placement = profile.conditioningPreference ?? "post_workout";
  const modality = profile.lowImpactConditioning ? "recumbent_bike" : profile.cardioPreference === "cycling" ? "upright_bike" : profile.cardioPreference === "rowing" ? "rower" : "incline_treadmill";
  return Array.from({ length: Math.min(frequency, 3) }, (_, i) => ({ id: `conditioning-${i + 1}`, modality, duration: profile.sessionMinutes <= 45 ? 20 : 30, intensity: profile.goal === "general_fitness" && i === 0 ? "steady" : "easy", placement: placement === "separate_day" ? "separate_day" : "post_workout", day: placement === "separate_day" ? trainingDays[i % trainingDays.length] : trainingDays[(i + 1) % trainingDays.length], rationale: modality === "incline_treadmill" ? "A practical, moderate conditioning option." : "A lower-impact conditioning option matched to your preference." }));
}

export function weeklyVolume(sessions: PlannedSession[], catalogue = allExercises()) {
  const map = new Map(catalogue.map(e => [e.id, e])); const result: Record<string, number> = {};
  for (const s of sessions) for (const id of s.exerciseIds) { const ex = map.get(id); if (!ex) continue; const sets = s.exerciseOverrides?.[id]?.sets ?? ex.sets; for (const muscle of taxonomyForExercise(ex).muscles) { const key = muscleAliases[muscle] ?? muscle; result[key] = (result[key] ?? 0) + sets; } }
  return result;
}

export function validateProgramme(sessions: PlannedSession[], profile: TrainingProfile) {
  const issues: string[] = []; const volume = weeklyVolume(sessions); const maxExercises = profile.experience === "beginner" || profile.sessionMinutes <= 45 ? 6 : 8;
  if (sessions.some(s => s.exerciseIds.length > maxExercises)) issues.push("session-too-large");
  if ((volume.quads ?? 0) < 6 && profile.daysPerWeek >= 3) issues.push("insufficient-quad-exposure");
  if ((volume.back_width ?? 0) + (volume.back_thickness ?? 0) > 28) issues.push("excessive-back-volume");
  if (sessions.some(s => new Set(s.exerciseIds).size !== s.exerciseIds.length)) issues.push("duplicate-exercise");
  return { valid: issues.length === 0, issues, volume };
}

export type ProgrammeEditIntent = { kind: "replace" | "add" | "remove" | "priority" | "conditioning"; query: string; target?: string };
export function detectProgrammeEditIntent(text: string): ProgrammeEditIntent | undefined {
  const t = text.toLowerCase(); const target = ["hip thrust", "bulgarian split squat", "leg press", "leg extension", "barbell row", "back squat", "treadmill", "rower", "lateral raise", "bench press"].find(x => t.includes(x));
  if (/replace|swap|change/.test(t)) return { kind: "replace", query: text, target };
  if (/add|include|want .* in my programme/.test(t)) return { kind: "add", query: text, target };
  if (/conditioning|cardio|treadmill|rower/.test(t) && (/hate|dislike|prefer|rather/.test(t))) return { kind: "conditioning", query: text, target };
  if (/remove|take out|hate|dislike/.test(t)) return { kind: "remove", query: text, target };
  if (/more (glute|upper.?chest|arm|back|shoulder|core)/.test(t)) return { kind: "priority", query: text, target };
  if (/conditioning|cardio|treadmill|rower/.test(t)) return { kind: "conditioning", query: text, target };
  return undefined;
}

export type ProgrammeEditPlan = { kind: ProgrammeEditIntent["kind"]; summary: string; rationale: string; sessionId?: string; fromExerciseId?: string; toExerciseId?: string; priority?: TrainingPriority; conditioning?: Partial<TrainingProfile>; };
export function planProgrammeEdit(programme: { week: PlannedSession[]; profile: TrainingProfile }, intent: ProgrammeEditIntent, catalogue = allExercises()): ProgrammeEditPlan | undefined {
  const find = (value?: string) => value && catalogue.find(e => e.id === value || e.name.toLowerCase().includes(value.toLowerCase()));
  if (intent.kind === "priority") { const priority = ["glutes", "upper_chest", "arms", "shoulders", "back_width", "core"].find(p => intent.query.toLowerCase().includes(p.replace("_", " "))) as TrainingPriority | undefined; return priority ? { kind: intent.kind, priority, summary: `Add ${priority.replace("_", " ")} emphasis`, rationale: "Rebalances exercise choice and order within the existing volume guardrails." } : undefined; }
  if (intent.kind === "conditioning") { const rower = /rower|rowing/.test(intent.query.toLowerCase()); return { kind: intent.kind, summary: rower ? "Use rowing for conditioning" : "Update conditioning preference", rationale: "Keeps conditioning aligned with your preferred, sustainable modality.", conditioning: { cardioPreference: rower ? "rowing" : undefined, dislikedConditioning: /hate|dislike/.test(intent.query.toLowerCase()) ? ["incline_treadmill"] : undefined } }; }
  const target = find(intent.target); if (!target) return undefined;
  const session = programme.week.find(s => s.exerciseIds.includes(target.id));
  if (intent.kind === "remove") return session ? { kind: intent.kind, summary: `Remove ${target.name}`, rationale: "The remaining session still has a complete movement balance.", sessionId: session.id, fromExerciseId: target.id } : undefined;
  if (intent.kind === "replace") { const replacement = intent.query.toLowerCase().includes("bulgarian") ? find("bulgarian-split-squat") : intent.query.toLowerCase().includes("hip thrust") ? find("barbell-hip-thrust") : undefined; if (!replacement || !session) return undefined; return { kind: intent.kind, summary: `Replace ${target.name} with ${replacement.name}`, rationale: "This keeps the movement role and training stimulus while respecting your preference.", sessionId: session.id, fromExerciseId: target.id, toExerciseId: replacement.id }; }
  if (intent.kind === "add") { const session = programme.week.find(s => s.exerciseIds.some(id => id.includes("hip-thrust") || id.includes("glute"))) ?? programme.week[programme.week.length - 1]; return { kind: intent.kind, summary: `Add ${target.name}`, rationale: "Adds the requested exercise only where session size and weekly balance allow.", sessionId: session?.id, toExerciseId: target.id }; }
  return undefined;
}
export function applyProgrammeEdit(programme: any, plan: ProgrammeEditPlan, catalogue = allExercises()) {
  const next = structuredClone(programme); const session = next.week.find((s: PlannedSession) => s.id === plan.sessionId); if (plan.kind === "priority" && plan.priority) { next.profile = { ...next.profile, priorities: [plan.priority] }; return next; }
  if (plan.kind === "conditioning" && plan.conditioning) { next.profile = { ...next.profile, ...plan.conditioning }; return next; }
  if (!session) return undefined;
  if (plan.kind === "remove" && plan.fromExerciseId) { session.exerciseIds = session.exerciseIds.filter((id: string) => id !== plan.fromExerciseId); delete session.exerciseOverrides?.[plan.fromExerciseId]; }
  if (plan.kind === "replace" && plan.fromExerciseId && plan.toExerciseId) { const at = session.exerciseIds.indexOf(plan.fromExerciseId); if (at < 0) return undefined; session.exerciseIds[at] = plan.toExerciseId; const source = catalogue.find(e => e.id === plan.toExerciseId); if (source) session.exerciseOverrides = { ...session.exerciseOverrides, [source.id]: { sets: source.sets, target: source.target } }; delete session.exerciseOverrides?.[plan.fromExerciseId]; }
  if (plan.kind === "add" && plan.toExerciseId && !session.exerciseIds.includes(plan.toExerciseId)) { session.exerciseIds.push(plan.toExerciseId); const source = catalogue.find(e => e.id === plan.toExerciseId); if (source) session.exerciseOverrides = { ...session.exerciseOverrides, [source.id]: { sets: source.sets, target: source.target } }; }
  return next;
}
