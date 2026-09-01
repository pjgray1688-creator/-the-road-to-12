import type { Exercise, Equipment } from "./types";
import { exerciseKnowledge } from "./exercise-library";
import { allExercises } from "./workout";
import { progressionProfile } from "./progression";

export type SubstitutionIntent = "equipment_unavailable" | "pain_or_discomfort" | "request_alternative" | "request_equipment_variant" | "performance_feedback" | "general_question";
export type DetectedIntent = { kind: SubstitutionIntent; equipment?: Equipment; pain: boolean };
export type RankedSubstitution = { exercise: Exercise; score: number; reason: string; profile: ReturnType<typeof progressionProfile> };

export function detectSubstitutionIntent(message: string): DetectedIntent {
  const text = message.toLowerCase();
  const pain = /pain|hurt|hurts|sharp|unstable|discomfort|aggravat|joint/.test(text);
  if (pain) return { kind: "pain_or_discomfort", pain: true };
  const equipment = /dumbbell|\bdb\b/.test(text) ? "dumbbell" : /cable/.test(text) ? "cable" : /barbell|bar/.test(text) ? "barbell" : /machine|stack/.test(text) ? "machine" : undefined;
  if (/busy|unavailable|don't have|do not have|no equipment|occupied|broken/.test(text)) return { kind: "equipment_unavailable", equipment, pain: false };
  if (equipment && /instead|variant|use|switch/.test(text)) return { kind: "request_equipment_variant", equipment, pain: false };
  if (/substitut|alternative|another exercise|replace|change exercise/.test(text)) return { kind: "request_alternative", equipment, pain: false };
  if (/easy|hard|rir|reps|heavy|light/.test(text)) return { kind: "performance_feedback", pain: false };
  return { kind: "general_question", pain: false };
}

const overlap = (a: string[], b: string[]) => a.filter(item => b.includes(item)).length;
export function rankSubstitutions(original: Exercise, options: Exercise[] = allExercises(), intent: DetectedIntent | SubstitutionIntent = "request_alternative"): RankedSubstitution[] {
  const detected = typeof intent === "string" ? { kind: intent, pain: intent === "pain_or_discomfort" } : intent;
  const source = exerciseKnowledge(original.id);
  return options.filter(candidate => candidate.id !== original.id).map(candidate => {
    const knowledge = exerciseKnowledge(candidate.id);
    const profile = progressionProfile(candidate);
    let score = 0;
    if (source && knowledge) {
      score += source.movementPattern === knowledge.movementPattern ? 6 : 0;
      score += overlap(source.primaryMuscles, knowledge.primaryMuscles) * 3;
      score += source.programmeRole === knowledge.programmeRole ? 2 : 0;
      score += source.compound === knowledge.compound ? 1 : 0;
    }
    if (detected.equipment && candidate.equipment === detected.equipment) score += 4;
    if (detected.kind === "pain_or_discomfort" && source && knowledge && source.jointDemands.some(joint => !knowledge.jointDemands.includes(joint))) score += 2;
    if (source && knowledge && source.unilateral === knowledge.unilateral) score += 1;
    const reason = detected.kind === "pain_or_discomfort" ? "A lower-irritation option that keeps the same training purpose." : detected.equipment ? `Keeps the movement focus with ${candidate.equipment} equipment.` : "A close match for the same movement and target muscles.";
    return { exercise: candidate, score, reason, profile };
  }).sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name)).slice(0, 5);
}

